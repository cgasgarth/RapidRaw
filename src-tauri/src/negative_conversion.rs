use crate::file_management::{parse_virtual_path, read_file_mapped};
use crate::formats::jpeg_data_url;
use crate::image_loader::load_base_image_from_bytes;
use crate::image_processing::RawEngineArtifacts;
use base64::{Engine as _, engine::general_purpose};
use chrono::Utc;
use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, Rgb32FImage};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::Cursor;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use uuid::Uuid;

use crate::AppState;
use crate::image_processing::downscale_f32_image;
use crate::load_settings_or_default;
use tauri::Emitter;

#[derive(Serialize, Deserialize, Debug, Clone, Copy)]
pub struct NegativeConversionParams {
    pub red_weight: f32,
    pub green_weight: f32,
    pub blue_weight: f32,

    #[serde(default = "default_base_fog_strength")]
    pub base_fog_strength: f32,
    #[serde(default)]
    pub base_fog_sample: Option<NegativeBaseFogSampleRect>,
    pub exposure: f32,
    pub contrast: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct NegativeBaseFogSampleRect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, Default)]
#[serde(rename_all = "snake_case")]
pub enum NegativeConversionOutputFormat {
    JpegProof,
    #[default]
    Tiff16,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NegativeConversionSaveOptions {
    pub output_format: NegativeConversionOutputFormat,
    pub suffix: String,
    #[serde(default)]
    pub accepted_dry_run_plan_hash: Option<String>,
    #[serde(default)]
    pub accepted_dry_run_plan_id: Option<String>,
    #[serde(default)]
    pub profile_provenance_hash: Option<String>,
}

#[derive(Serialize, Debug, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct NegativeBaseFogEstimate {
    pub red_weight: f32,
    pub green_weight: f32,
    pub blue_weight: f32,
    pub base_rgb: [f32; 3],
    pub base_density: [f32; 3],
    pub confidence: f32,
}

const MIN_CHANNEL_WEIGHT: f32 = 0.5;
const MAX_CHANNEL_WEIGHT: f32 = 2.0;
const MIN_BASE_FOG_STRENGTH: f32 = 0.0;
const MAX_BASE_FOG_STRENGTH: f32 = 1.25;
const MIN_EXPOSURE: f32 = -2.0;
const MAX_EXPOSURE: f32 = 2.0;
const MIN_CONTRAST: f32 = 0.5;
const MAX_CONTRAST: f32 = 2.5;
const DEFAULT_OUTPUT_SUFFIX: &str = "Positive";
const JPEG_PROOF_QUALITY: u8 = 92;

fn default_base_fog_strength() -> f32 {
    1.0
}

impl Default for NegativeConversionSaveOptions {
    fn default() -> Self {
        Self {
            output_format: NegativeConversionOutputFormat::Tiff16,
            suffix: DEFAULT_OUTPUT_SUFFIX.to_string(),
            accepted_dry_run_plan_hash: None,
            accepted_dry_run_plan_id: None,
            profile_provenance_hash: None,
        }
    }
}

impl NegativeConversionSaveOptions {
    fn sanitized(self) -> Self {
        let suffix = sanitize_output_suffix(&self.suffix);

        Self {
            output_format: self.output_format,
            suffix,
            accepted_dry_run_plan_hash: self.accepted_dry_run_plan_hash,
            accepted_dry_run_plan_id: self.accepted_dry_run_plan_id,
            profile_provenance_hash: self
                .profile_provenance_hash
                .filter(|hash| is_valid_negative_lab_profile_provenance_hash(hash)),
        }
    }

    fn validate_accepted_batch_plan(&self, paths_len: usize) -> Result<(), String> {
        if paths_len <= 1 {
            return Ok(());
        }

        let plan_hash = self.accepted_dry_run_plan_hash.as_deref().ok_or_else(|| {
            "Batch negative export requires an accepted dry-run plan hash.".to_string()
        })?;
        let plan_id = self.accepted_dry_run_plan_id.as_deref().ok_or_else(|| {
            "Batch negative export requires an accepted dry-run plan id.".to_string()
        })?;

        if !is_valid_negative_lab_plan_hash(plan_hash) {
            return Err("Batch negative export accepted dry-run plan hash is invalid.".to_string());
        }

        let hash_suffix = plan_hash.strip_prefix("fnv1a32:").ok_or_else(|| {
            "Batch negative export accepted dry-run plan hash is invalid.".to_string()
        })?;
        let expected_plan_id = format!("negative_lab_batch_plan_{hash_suffix}");
        if plan_id != expected_plan_id {
            return Err(
                "Batch negative export accepted dry-run plan id does not match hash.".to_string(),
            );
        }

        Ok(())
    }
}

impl Default for NegativeConversionParams {
    fn default() -> Self {
        Self {
            red_weight: 1.0,
            green_weight: 1.0,
            blue_weight: 1.0,
            base_fog_strength: default_base_fog_strength(),
            base_fog_sample: None,
            exposure: 0.0,
            contrast: 1.0,
        }
    }
}

fn sanitize_output_suffix(suffix: &str) -> String {
    let sanitized: String = suffix
        .chars()
        .filter_map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_') {
                Some(c)
            } else if c.is_whitespace() {
                Some('_')
            } else {
                None
            }
        })
        .take(40)
        .collect();

    if sanitized.is_empty() {
        DEFAULT_OUTPUT_SUFFIX.to_string()
    } else {
        sanitized
    }
}

fn is_valid_negative_lab_plan_hash(plan_hash: &str) -> bool {
    let Some(hash_suffix) = plan_hash.strip_prefix("fnv1a32:") else {
        return false;
    };

    hash_suffix.len() == 8 && hash_suffix.chars().all(|value| value.is_ascii_hexdigit())
}

fn is_valid_negative_lab_profile_provenance_hash(profile_hash: &str) -> bool {
    is_valid_negative_lab_plan_hash(profile_hash)
}

fn build_negative_output_path(
    real_path: &str,
    save_options: &NegativeConversionSaveOptions,
) -> PathBuf {
    let p = Path::new(real_path);
    let parent = p.parent().unwrap_or(Path::new(""));
    let stem = p.file_stem().unwrap_or_default().to_string_lossy();
    let extension = match save_options.output_format {
        NegativeConversionOutputFormat::JpegProof => "jpg",
        NegativeConversionOutputFormat::Tiff16 => "tiff",
    };
    let filename = format!("{}_{}.{}", stem, save_options.suffix, extension);
    parent.join(&filename)
}

fn negative_lab_output_sidecar_path(output_path: &Path) -> PathBuf {
    output_path.with_file_name(format!(
        "{}.rrdata",
        output_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
    ))
}

fn hash_negative_lab_output_file(output_path: &Path) -> Result<String, String> {
    let bytes = fs::read(output_path)
        .map_err(|e| format!("Failed to read Negative Lab output for sidecar hash: {}", e))?;
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in bytes {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    Ok(format!("fnv1a64:{hash:016x}"))
}

fn write_negative_lab_output_sidecar(
    output_path: &Path,
    source_path: &Path,
    params: &NegativeConversionParams,
    save_options: &NegativeConversionSaveOptions,
    output_width: u32,
    output_height: u32,
) -> Result<(), String> {
    let sidecar_path = negative_lab_output_sidecar_path(output_path);
    let mut sidecar = crate::exif_processing::load_sidecar(&sidecar_path);
    let artifact_id = format!("artifact_negative_lab_{}", Uuid::new_v4().simple());
    let output_artifact_id = format!("{}_output", artifact_id);
    let content_hash = hash_negative_lab_output_file(output_path)?;
    let output_format = match save_options.output_format {
        NegativeConversionOutputFormat::JpegProof => "jpeg_proof",
        NegativeConversionOutputFormat::Tiff16 => "tiff16",
    };

    let artifact = serde_json::json!({
        "artifactId": artifact_id,
        "createdAt": Utc::now().to_rfc3339(),
        "conversion": {
            "acceptedDryRunPlanHash": save_options.accepted_dry_run_plan_hash,
            "acceptedDryRunPlanId": save_options.accepted_dry_run_plan_id,
            "outputFormat": output_format,
            "params": params,
            "profileProvenanceHash": save_options.profile_provenance_hash,
        },
        "operationId": "negative_lab.convert",
        "operationVersion": 1,
        "outputArtifacts": [{
            "artifactId": output_artifact_id,
            "contentHash": content_hash,
            "dimensions": {
                "height": output_height,
                "width": output_width,
            },
            "kind": "negative_lab_positive",
            "storage": "sidecar_artifact",
        }],
        "provenance": {
            "commandId": "command_negative_lab_convert",
            "profileProvenanceHash": save_options.profile_provenance_hash,
            "runtimeStatus": "rendered",
        },
        "schemaVersion": 1,
        "sourceImageRefs": [{
            "imagePath": source_path.to_string_lossy(),
        }],
        "warnings": [],
    });

    let artifacts = sidecar
        .raw_engine_artifacts
        .get_or_insert_with(RawEngineArtifacts::new_v1);
    artifacts.schema_version = 1;
    artifacts.negative_lab_artifacts.push(artifact);
    artifacts.stale_artifact_ids.retain(|id| !id.is_empty());

    let json = serde_json::to_string_pretty(&sidecar)
        .map_err(|e| format!("Failed to serialize Negative Lab sidecar: {}", e))?;
    fs::write(&sidecar_path, json).map_err(|e| {
        format!(
            "Failed to write Negative Lab sidecar {}: {}",
            sidecar_path.display(),
            e
        )
    })
}

impl NegativeConversionParams {
    fn sanitized(self) -> Self {
        fn finite_or_default(value: f32, fallback: f32) -> f32 {
            if value.is_finite() { value } else { fallback }
        }

        let defaults = Self::default();

        Self {
            red_weight: finite_or_default(self.red_weight, defaults.red_weight)
                .clamp(MIN_CHANNEL_WEIGHT, MAX_CHANNEL_WEIGHT),
            green_weight: finite_or_default(self.green_weight, defaults.green_weight)
                .clamp(MIN_CHANNEL_WEIGHT, MAX_CHANNEL_WEIGHT),
            blue_weight: finite_or_default(self.blue_weight, defaults.blue_weight)
                .clamp(MIN_CHANNEL_WEIGHT, MAX_CHANNEL_WEIGHT),
            base_fog_strength: finite_or_default(
                self.base_fog_strength,
                defaults.base_fog_strength,
            )
            .clamp(MIN_BASE_FOG_STRENGTH, MAX_BASE_FOG_STRENGTH),
            base_fog_sample: self.base_fog_sample.and_then(sanitize_sample_rect),
            exposure: finite_or_default(self.exposure, defaults.exposure)
                .clamp(MIN_EXPOSURE, MAX_EXPOSURE),
            contrast: finite_or_default(self.contrast, defaults.contrast)
                .clamp(MIN_CONTRAST, MAX_CONTRAST),
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct ChannelBounds {
    pub min: f32,
    pub max: f32,
}

fn sanitize_sample_rect(rect: NegativeBaseFogSampleRect) -> Option<NegativeBaseFogSampleRect> {
    if !rect.x.is_finite()
        || !rect.y.is_finite()
        || !rect.width.is_finite()
        || !rect.height.is_finite()
    {
        return None;
    }

    let x = rect.x.clamp(0.0, 0.98);
    let y = rect.y.clamp(0.0, 0.98);
    let width = rect.width.clamp(0.02, 1.0 - x);
    let height = rect.height.clamp(0.02, 1.0 - y);

    Some(NegativeBaseFogSampleRect {
        x,
        y,
        width,
        height,
    })
}

fn analyze_bounds(
    log_data: &[f32],
    width: usize,
    height: usize,
    sample_rect: Option<NegativeBaseFogSampleRect>,
) -> [ChannelBounds; 3] {
    let sanitized_rect = sample_rect.and_then(sanitize_sample_rect);
    let (start_x, end_x, start_y, end_y) = if let Some(rect) = sanitized_rect {
        let start_x = ((rect.x * width as f32).floor() as usize).min(width.saturating_sub(1));
        let start_y = ((rect.y * height as f32).floor() as usize).min(height.saturating_sub(1));
        let end_x =
            (((rect.x + rect.width) * width as f32).ceil() as usize).clamp(start_x + 1, width);
        let end_y =
            (((rect.y + rect.height) * height as f32).ceil() as usize).clamp(start_y + 1, height);
        (start_x, end_x, start_y, end_y)
    } else {
        let margin_x = (width as f32 * 0.12) as usize;
        let margin_y = (height as f32 * 0.12) as usize;
        (
            margin_x,
            width.saturating_sub(margin_x),
            margin_y,
            height.saturating_sub(margin_y),
        )
    };

    let est_pixels = (end_x.saturating_sub(start_x)) * (end_y.saturating_sub(start_y));
    let step = (est_pixels / 40_000).max(1);
    let row_step = if sanitized_rect.is_some() { 1 } else { 3 };

    let mut r_vals = Vec::with_capacity(est_pixels / step);
    let mut g_vals = Vec::with_capacity(est_pixels / step);
    let mut b_vals = Vec::with_capacity(est_pixels / step);

    for y in (start_y..end_y).step_by(row_step) {
        let row_offset = y * width * 3;

        for x in (start_x..end_x).step_by(step) {
            let idx = row_offset + (x * 3);

            if idx + 2 < log_data.len() {
                let r = log_data[idx];
                let g = log_data[idx + 1];
                let b = log_data[idx + 2];

                if r.is_finite() {
                    r_vals.push(r);
                }
                if g.is_finite() {
                    g_vals.push(g);
                }
                if b.is_finite() {
                    b_vals.push(b);
                }
            }
        }
    }

    let get_bounds = |mut vals: Vec<f32>| -> ChannelBounds {
        if vals.is_empty() {
            return ChannelBounds { min: 0.0, max: 1.0 };
        }

        vals.sort_by(|a, b| a.partial_cmp(b).unwrap_or(Ordering::Equal));

        let len = vals.len() as f32;

        let min_idx = (len * 0.001) as usize;
        let max_idx = (len * 0.999) as usize;

        let min = vals[min_idx.min(vals.len().saturating_sub(1))];
        let max = vals[max_idx.min(vals.len().saturating_sub(1))];

        let safe_max = if max <= min + 0.0001 { min + 1.0 } else { max };

        ChannelBounds { min, max: safe_max }
    };

    [get_bounds(r_vals), get_bounds(g_vals), get_bounds(b_vals)]
}

fn estimate_base_fog_from_image(
    input: &DynamicImage,
    sample_rect: Option<NegativeBaseFogSampleRect>,
) -> NegativeBaseFogEstimate {
    let rgb = input.to_rgb32f();
    let (width, height) = rgb.dimensions();
    let log_pixels: Vec<f32> = rgb
        .as_raw()
        .par_iter()
        .map(|&v| -v.clamp(1e-6, 1.0).log10())
        .collect();
    let bounds = analyze_bounds(&log_pixels, width as usize, height as usize, sample_rect);

    let base_densities = [
        bounds[0].min.max(0.001),
        bounds[1].min.max(0.001),
        bounds[2].min.max(0.001),
    ];
    let mean_density = (base_densities[0] + base_densities[1] + base_densities[2]) / 3.0;
    let channel_spread = base_densities.iter().fold(0.0_f32, |max_value, value| {
        max_value.max((value - mean_density).abs())
    });
    let density_range = [
        bounds[0].max - bounds[0].min,
        bounds[1].max - bounds[1].min,
        bounds[2].max - bounds[2].min,
    ];
    let mean_range = (density_range[0] + density_range[1] + density_range[2]) / 3.0;

    let to_weight = |density: f32| {
        (mean_density / density.max(0.001)).clamp(MIN_CHANNEL_WEIGHT, MAX_CHANNEL_WEIGHT)
    };

    NegativeBaseFogEstimate {
        red_weight: to_weight(base_densities[0]),
        green_weight: to_weight(base_densities[1]),
        blue_weight: to_weight(base_densities[2]),
        base_rgb: base_densities.map(|density| 10.0_f32.powf(-density).clamp(0.0, 1.0)),
        base_density: base_densities,
        confidence: ((mean_range * 2.0) + (channel_spread * 1.5)).clamp(0.0, 1.0),
    }
}

fn run_pipeline(
    input: &DynamicImage,
    params: &NegativeConversionParams,
    override_bounds: Option<[ChannelBounds; 3]>,
) -> DynamicImage {
    let params = params.sanitized();
    let rgb = input.to_rgb32f();
    let (width, height) = rgb.dimensions();
    let raw_pixels = rgb.as_raw();

    let log_pixels: Vec<f32> = raw_pixels
        .par_iter()
        .map(|&v| -v.clamp(1e-6, 1.0).log10())
        .collect();

    let bounds = if let Some(b) = override_bounds {
        b
    } else {
        analyze_bounds(
            &log_pixels,
            width as usize,
            height as usize,
            params.base_fog_sample,
        )
    };

    let mut out_buffer = vec![0.0f32; raw_pixels.len()];

    let k = 4.0 * params.contrast;
    let x0 = 0.6 - (params.exposure * 0.25);
    let gamma_inv = 1.0 / 2.2;

    let y0 = 1.0 / (1.0 + (k * x0).exp());
    let y1 = 1.0 / (1.0 + (-k * (1.0 - x0)).exp());
    let scale = 1.0 / (y1 - y0);

    out_buffer
        .par_chunks_mut(3)
        .enumerate()
        .for_each(|(i, out_pixel)| {
            let idx = i * 3;

            let base_r = bounds[0].min * params.base_fog_strength;
            let base_g = bounds[1].min * params.base_fog_strength;
            let base_b = bounds[2].min * params.base_fog_strength;

            let mut n_r = (log_pixels[idx] - base_r) / (bounds[0].max - base_r).max(0.0001);
            let mut n_g = (log_pixels[idx + 1] - base_g) / (bounds[1].max - base_g).max(0.0001);
            let mut n_b = (log_pixels[idx + 2] - base_b) / (bounds[2].max - base_b).max(0.0001);

            n_r = n_r.max(0.0) * params.red_weight;
            n_g = n_g.max(0.0) * params.green_weight;
            n_b = n_b.max(0.0) * params.blue_weight;

            let apply_curve = |x: f32| -> f32 {
                let sigmoid = 1.0 / (1.0 + (-k * (x - x0)).exp());
                let s_norm = (sigmoid - y0) * scale;
                s_norm.clamp(0.0, 1.0)
            };

            let mut r = apply_curve(n_r);
            let mut g = apply_curve(n_g);
            let mut b = apply_curve(n_b);

            let luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            let max_ch = r.max(g).max(b);

            if max_ch > 0.9 {
                let overflow = ((max_ch - 0.9) * 10.0).clamp(0.0, 1.0);
                let sat_reduction = overflow * overflow;

                r = r + (luma - r) * sat_reduction;
                g = g + (luma - g) * sat_reduction;
                b = b + (luma - b) * sat_reduction;
            }

            out_pixel[0] = r.clamp(0.0, 1.0).powf(gamma_inv);
            out_pixel[1] = g.clamp(0.0, 1.0).powf(gamma_inv);
            out_pixel[2] = b.clamp(0.0, 1.0).powf(gamma_inv);
        });

    let out_img = Rgb32FImage::from_vec(width, height, out_buffer).unwrap();
    DynamicImage::ImageRgb32F(out_img)
}

#[tauri::command]
pub async fn preview_negative_conversion(
    path: String,
    params: NegativeConversionParams,
    state: tauri::State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<String, String> {
    let (source_path, _) = parse_virtual_path(&path);
    let source_path_str = source_path.to_string_lossy().to_string();

    let mut hasher = DefaultHasher::new();
    source_path_str.hash(&mut hasher);
    "negative_preview_base".hash(&mut hasher);
    let cache_key = hasher.finish();

    let base_image_for_processing = {
        let mut cache = state.geometry_cache.lock().unwrap();

        if let Some(cached_img) = cache.get(&cache_key) {
            cached_img.clone()
        } else {
            let image_to_downscale = {
                let original_lock = state.original_image.lock().unwrap();
                if let Some(loaded) = original_lock.as_ref() {
                    if loaded.path == source_path_str {
                        loaded.image.clone().as_ref().clone()
                    } else {
                        drop(original_lock);
                        let settings = load_settings_or_default(&app_handle);

                        match read_file_mapped(Path::new(&source_path_str)) {
                            Ok(mmap) => load_base_image_from_bytes(
                                &mmap,
                                &source_path_str,
                                false,
                                &settings,
                                None,
                            )
                            .map_err(|e| e.to_string())?,
                            Err(_e) => {
                                let bytes = fs::read(&source_path_str)
                                    .map_err(|io_err| io_err.to_string())?;
                                load_base_image_from_bytes(
                                    &bytes,
                                    &source_path_str,
                                    false,
                                    &settings,
                                    None,
                                )
                                .map_err(|e| e.to_string())?
                            }
                        }
                    }
                } else {
                    drop(original_lock);
                    let settings = load_settings_or_default(&app_handle);

                    match read_file_mapped(Path::new(&source_path_str)) {
                        Ok(mmap) => load_base_image_from_bytes(
                            &mmap,
                            &source_path_str,
                            false,
                            &settings,
                            None,
                        )
                        .map_err(|e| e.to_string())?,
                        Err(_e) => {
                            let bytes =
                                fs::read(&source_path_str).map_err(|io_err| io_err.to_string())?;
                            load_base_image_from_bytes(
                                &bytes,
                                &source_path_str,
                                false,
                                &settings,
                                None,
                            )
                            .map_err(|e| e.to_string())?
                        }
                    }
                }
            };

            let downscaled = downscale_f32_image(&image_to_downscale, 1080, 1080);

            cache.insert(cache_key, downscaled.clone());
            downscaled
        }
    };

    let processed = run_pipeline(&base_image_for_processing, &params, None);

    let mut buf = Cursor::new(Vec::new());
    processed
        .to_rgb8()
        .write_with_encoder(JpegEncoder::new_with_quality(&mut buf, 80))
        .map_err(|e| e.to_string())?;

    let base64_str = general_purpose::STANDARD.encode(buf.get_ref());
    Ok(jpeg_data_url(base64_str))
}

#[tauri::command]
pub async fn estimate_negative_base_fog(
    path: String,
    sample_rect: Option<NegativeBaseFogSampleRect>,
    state: tauri::State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<NegativeBaseFogEstimate, String> {
    let (source_path, _) = parse_virtual_path(&path);
    let source_path_str = source_path.to_string_lossy().to_string();

    let image = {
        let original_lock = state.original_image.lock().unwrap();
        if let Some(loaded) = original_lock.as_ref() {
            if loaded.path == source_path_str {
                loaded.image.clone().as_ref().clone()
            } else {
                drop(original_lock);
                let settings = load_settings_or_default(&app_handle);
                match read_file_mapped(Path::new(&source_path_str)) {
                    Ok(mmap) => {
                        load_base_image_from_bytes(&mmap, &source_path_str, false, &settings, None)
                    }
                    Err(_) => {
                        let bytes =
                            fs::read(&source_path_str).map_err(|io_err| io_err.to_string())?;
                        load_base_image_from_bytes(&bytes, &source_path_str, false, &settings, None)
                    }
                }
                .map_err(|e| e.to_string())?
            }
        } else {
            drop(original_lock);
            let settings = load_settings_or_default(&app_handle);
            match read_file_mapped(Path::new(&source_path_str)) {
                Ok(mmap) => {
                    load_base_image_from_bytes(&mmap, &source_path_str, false, &settings, None)
                }
                Err(_) => {
                    let bytes = fs::read(&source_path_str).map_err(|io_err| io_err.to_string())?;
                    load_base_image_from_bytes(&bytes, &source_path_str, false, &settings, None)
                }
            }
            .map_err(|e| e.to_string())?
        }
    };

    let downscaled = downscale_f32_image(&image, 1080, 1080);
    Ok(estimate_base_fog_from_image(&downscaled, sample_rect))
}

#[tauri::command]
pub async fn convert_negatives(
    paths: Vec<String>,
    params: NegativeConversionParams,
    options: Option<NegativeConversionSaveOptions>,
    app_handle: AppHandle,
) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || {
        let mut results = Vec::new();
        let save_options = options.unwrap_or_default().sanitized();
        save_options.validate_accepted_batch_plan(paths.len())?;

        for (i, path_str) in paths.iter().enumerate() {
            let _ = app_handle.emit(
                "negative-batch-progress",
                serde_json::json!({
                    "current": i + 1,
                    "total": paths.len(),
                    "path": path_str
                }),
            );

            let (source_path, _) = parse_virtual_path(path_str);
            let real_path = source_path.to_string_lossy().to_string();
            let sanitized_params = params.sanitized();

            let settings = load_settings_or_default(&app_handle);

            let img = match read_file_mapped(Path::new(&real_path)) {
                Ok(mmap) => load_base_image_from_bytes(&mmap, &real_path, false, &settings, None),
                Err(_) => {
                    let bytes = fs::read(&real_path).unwrap_or_default();
                    load_base_image_from_bytes(&bytes, &real_path, false, &settings, None)
                }
            }
            .map_err(|e| e.to_string())?;

            let bounds_ref = downscale_f32_image(&img, 1080, 1080);
            let ref_rgb = bounds_ref.to_rgb32f();
            let (ref_w, ref_h) = ref_rgb.dimensions();
            let log_pixels: Vec<f32> = ref_rgb
                .as_raw()
                .par_iter()
                .map(|&v| -v.clamp(1e-6, 1.0).log10())
                .collect();
            let bounds = analyze_bounds(
                &log_pixels,
                ref_w as usize,
                ref_h as usize,
                sanitized_params.base_fog_sample,
            );

            let processed = run_pipeline(&img, &sanitized_params, Some(bounds));

            let out_path = build_negative_output_path(&real_path, &save_options);
            let filename = out_path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            match save_options.output_format {
                NegativeConversionOutputFormat::JpegProof => {
                    let mut buf = Cursor::new(Vec::new());
                    processed
                        .to_rgb8()
                        .write_with_encoder(JpegEncoder::new_with_quality(
                            &mut buf,
                            JPEG_PROOF_QUALITY,
                        ))
                        .map_err(|e| format!("Failed to encode {}: {}", filename, e))?;
                    fs::write(&out_path, buf.into_inner())
                        .map_err(|e| format!("Failed to save {}: {}", filename, e))?;
                }
                NegativeConversionOutputFormat::Tiff16 => {
                    processed
                        .to_rgb16()
                        .save(&out_path)
                        .map_err(|e| format!("Failed to save {}: {}", filename, e))?;
                }
            }

            let _ = crate::exif_processing::write_rrexif_sidecar(&real_path, &out_path);
            write_negative_lab_output_sidecar(
                &out_path,
                Path::new(&real_path),
                &sanitized_params,
                &save_options,
                processed.width(),
                processed.height(),
            )?;
            results.push(out_path.to_string_lossy().to_string());
        }

        Ok(results)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, Pixel, Rgb32FImage};
    use serde_json::json;

    fn render_fixture(
        pixels: Vec<f32>,
        params: NegativeConversionParams,
        bounds: [ChannelBounds; 3],
    ) -> Rgb32FImage {
        let input = DynamicImage::ImageRgb32F(Rgb32FImage::from_vec(3, 1, pixels).unwrap());
        run_pipeline(&input, &params, Some(bounds)).to_rgb32f()
    }

    fn luminance(pixel: image::Rgb<f32>) -> f32 {
        let channels = pixel.channels();
        0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
    }

    fn assert_images_near(left: &Rgb32FImage, right: &Rgb32FImage) {
        assert_eq!(left.dimensions(), right.dimensions());

        for (left_pixel, right_pixel) in left.pixels().zip(right.pixels()) {
            for (left_channel, right_channel) in
                left_pixel.channels().iter().zip(right_pixel.channels())
            {
                assert!(
                    (left_channel - right_channel).abs() <= 0.000_001,
                    "expected matching preview/export channel values, got {left_channel} and {right_channel}"
                );
            }
        }
    }

    fn mean_abs_delta(left: &Rgb32FImage, right: &Rgb32FImage) -> f32 {
        assert_eq!(left.dimensions(), right.dimensions());

        let mut total = 0.0_f32;
        let mut count = 0_u32;
        for (left_pixel, right_pixel) in left.pixels().zip(right.pixels()) {
            for (left_channel, right_channel) in
                left_pixel.channels().iter().zip(right_pixel.channels())
            {
                total += (left_channel - right_channel).abs();
                count += 1;
            }
        }

        total / count.max(1) as f32
    }

    fn hash_rendered_image(image: &Rgb32FImage) -> String {
        let mut hash = 0xcbf29ce484222325_u64;
        for pixel in image.pixels() {
            for channel in pixel.channels() {
                for byte in channel.to_bits().to_le_bytes() {
                    hash ^= u64::from(byte);
                    hash = hash.wrapping_mul(0x100000001b3);
                }
            }
        }

        format!("fnv1a64:{hash:016x}")
    }

    #[test]
    fn negative_conversion_params_clamp_to_supported_api_range() {
        let sanitized = NegativeConversionParams {
            red_weight: f32::NAN,
            green_weight: 99.0,
            blue_weight: -99.0,
            base_fog_strength: f32::NAN,
            base_fog_sample: Some(NegativeBaseFogSampleRect {
                x: f32::NAN,
                y: 0.0,
                width: 0.1,
                height: 0.1,
            }),
            exposure: f32::INFINITY,
            contrast: f32::NEG_INFINITY,
        }
        .sanitized();

        assert_eq!(
            sanitized.red_weight,
            NegativeConversionParams::default().red_weight
        );
        assert_eq!(sanitized.green_weight, MAX_CHANNEL_WEIGHT);
        assert_eq!(sanitized.blue_weight, MIN_CHANNEL_WEIGHT);
        assert_eq!(
            sanitized.base_fog_strength,
            NegativeConversionParams::default().base_fog_strength
        );
        assert!(sanitized.base_fog_sample.is_none());
        assert_eq!(
            sanitized.exposure,
            NegativeConversionParams::default().exposure
        );
        assert_eq!(
            sanitized.contrast,
            NegativeConversionParams::default().contrast
        );
    }

    #[test]
    fn negative_conversion_save_options_sanitize_output_suffix() {
        let sanitized = NegativeConversionSaveOptions {
            accepted_dry_run_plan_hash: None,
            accepted_dry_run_plan_id: None,
            profile_provenance_hash: Some("fnv1a32:2f4a91bc".to_string()),
            output_format: NegativeConversionOutputFormat::JpegProof,
            suffix: " Proof / Final:01 ".to_string(),
        }
        .sanitized();

        assert!(matches!(
            sanitized.output_format,
            NegativeConversionOutputFormat::JpegProof
        ));
        assert_eq!(sanitized.suffix, "_Proof__Final01_");
        assert_eq!(
            sanitized.profile_provenance_hash.as_deref(),
            Some("fnv1a32:2f4a91bc")
        );
    }

    #[test]
    fn negative_conversion_save_options_default_empty_suffix() {
        let sanitized = NegativeConversionSaveOptions {
            accepted_dry_run_plan_hash: None,
            accepted_dry_run_plan_id: None,
            profile_provenance_hash: Some("not-a-hash".to_string()),
            output_format: NegativeConversionOutputFormat::Tiff16,
            suffix: "///".to_string(),
        }
        .sanitized();

        assert_eq!(sanitized.suffix, DEFAULT_OUTPUT_SUFFIX);
        assert!(sanitized.profile_provenance_hash.is_none());
    }

    #[test]
    fn negative_conversion_output_paths_keep_original_safe() {
        let jpeg_options = NegativeConversionSaveOptions {
            accepted_dry_run_plan_hash: None,
            accepted_dry_run_plan_id: None,
            profile_provenance_hash: None,
            output_format: NegativeConversionOutputFormat::JpegProof,
            suffix: "Web Proof".to_string(),
        }
        .sanitized();
        let tiff_options = NegativeConversionSaveOptions {
            accepted_dry_run_plan_hash: None,
            accepted_dry_run_plan_id: None,
            profile_provenance_hash: None,
            output_format: NegativeConversionOutputFormat::Tiff16,
            suffix: "".to_string(),
        }
        .sanitized();

        let source_path = "/roll_01/frame_001.tif";
        let jpeg_output = build_negative_output_path(source_path, &jpeg_options);
        let tiff_output = build_negative_output_path(source_path, &tiff_options);

        assert_eq!(
            jpeg_output,
            PathBuf::from("/roll_01/frame_001_Web_Proof.jpg")
        );
        assert_eq!(
            tiff_output,
            PathBuf::from("/roll_01/frame_001_Positive.tiff")
        );
        assert_ne!(jpeg_output, PathBuf::from(source_path));
        assert_ne!(tiff_output, PathBuf::from(source_path));
    }

    #[test]
    fn negative_conversion_batch_exports_require_accepted_plan_identity() {
        let missing_plan = NegativeConversionSaveOptions::default();
        assert!(
            missing_plan.validate_accepted_batch_plan(2).is_err(),
            "batch export without accepted plan should fail"
        );
        assert!(missing_plan.validate_accepted_batch_plan(1).is_ok());

        let accepted_plan = NegativeConversionSaveOptions {
            accepted_dry_run_plan_hash: Some("fnv1a32:2f4a91bc".to_string()),
            accepted_dry_run_plan_id: Some("negative_lab_batch_plan_2f4a91bc".to_string()),
            profile_provenance_hash: Some("fnv1a32:aaaaaaaa".to_string()),
            output_format: NegativeConversionOutputFormat::Tiff16,
            suffix: DEFAULT_OUTPUT_SUFFIX.to_string(),
        };
        assert!(accepted_plan.validate_accepted_batch_plan(2).is_ok());

        let mismatched_plan = NegativeConversionSaveOptions {
            accepted_dry_run_plan_hash: Some("fnv1a32:2f4a91bc".to_string()),
            accepted_dry_run_plan_id: Some("negative_lab_batch_plan_deadbeef".to_string()),
            profile_provenance_hash: None,
            output_format: NegativeConversionOutputFormat::Tiff16,
            suffix: DEFAULT_OUTPUT_SUFFIX.to_string(),
        };
        assert!(mismatched_plan.validate_accepted_batch_plan(2).is_err());
    }

    #[test]
    fn negative_lab_output_sidecar_records_profile_provenance() {
        let temp_dir = tempfile::tempdir().expect("temp dir should be created");
        let source_path = temp_dir.path().join("frame_001.tif");
        let output_path = temp_dir.path().join("frame_001_Positive.tiff");
        fs::write(&source_path, b"negative-source").expect("source should be written");
        fs::write(&output_path, b"positive-output").expect("output should be written");
        let params = NegativeConversionParams {
            red_weight: 1.03,
            green_weight: 0.99,
            blue_weight: 1.02,
            base_fog_strength: 1.0,
            base_fog_sample: None,
            exposure: 0.1,
            contrast: 1.08,
        };
        let save_options = NegativeConversionSaveOptions {
            accepted_dry_run_plan_hash: Some("fnv1a32:2f4a91bc".to_string()),
            accepted_dry_run_plan_id: Some("negative_lab_batch_plan_2f4a91bc".to_string()),
            profile_provenance_hash: Some("fnv1a32:aaaaaaaa".to_string()),
            output_format: NegativeConversionOutputFormat::Tiff16,
            suffix: DEFAULT_OUTPUT_SUFFIX.to_string(),
        };

        write_negative_lab_output_sidecar(
            &output_path,
            &source_path,
            &params,
            &save_options,
            12,
            8,
        )
        .expect("sidecar should be written");

        let sidecar_path = negative_lab_output_sidecar_path(&output_path);
        let sidecar = crate::exif_processing::load_sidecar(&sidecar_path);
        let artifact = sidecar
            .raw_engine_artifacts
            .expect("rawEngineArtifacts should be present")
            .negative_lab_artifacts
            .pop()
            .expect("Negative Lab artifact should be present");

        assert_eq!(artifact["operationId"], "negative_lab.convert");
        assert_eq!(
            artifact["conversion"]["profileProvenanceHash"],
            "fnv1a32:aaaaaaaa"
        );
        assert_eq!(
            artifact["conversion"]["acceptedDryRunPlanId"],
            "negative_lab_batch_plan_2f4a91bc"
        );
        assert_eq!(artifact["outputArtifacts"][0]["dimensions"]["width"], 12);
        assert_eq!(artifact["outputArtifacts"][0]["dimensions"]["height"], 8);
        assert_eq!(
            artifact["outputArtifacts"][0]["kind"],
            "negative_lab_positive"
        );
        assert_eq!(
            artifact["outputArtifacts"][0]["storage"],
            "sidecar_artifact"
        );
        assert!(
            artifact["outputArtifacts"][0]["contentHash"]
                .as_str()
                .unwrap_or_default()
                .starts_with("fnv1a64:")
        );
    }

    #[test]
    fn negative_conversion_rejects_pathological_api_values_before_density_math() {
        let rendered = render_fixture(
            vec![
                0.92, 0.72, 0.52, //
                0.22, 0.16, 0.10, //
                0.03, 0.02, 0.01,
            ],
            NegativeConversionParams {
                red_weight: f32::NAN,
                green_weight: f32::INFINITY,
                blue_weight: f32::NEG_INFINITY,
                base_fog_strength: 99.0,
                base_fog_sample: None,
                exposure: 50.0,
                contrast: -50.0,
            },
            [
                ChannelBounds {
                    min: 0.02,
                    max: 1.5,
                },
                ChannelBounds {
                    min: 0.02,
                    max: 1.5,
                },
                ChannelBounds {
                    min: 0.02,
                    max: 1.5,
                },
            ],
        );

        for pixel in rendered.pixels() {
            for channel in pixel.channels() {
                assert!(channel.is_finite());
                assert!((0.0..=1.0).contains(channel));
            }
        }
    }

    #[test]
    fn color_negative_fixture_renders_finite_monotonic_positive_values() {
        let rendered = render_fixture(
            vec![
                0.82, 0.64, 0.46, //
                0.36, 0.28, 0.20, //
                0.09, 0.07, 0.05,
            ],
            NegativeConversionParams {
                red_weight: 1.2,
                green_weight: 1.0,
                blue_weight: 0.75,
                base_fog_strength: 1.0,
                base_fog_sample: None,
                exposure: 0.0,
                contrast: 1.0,
            },
            [
                ChannelBounds {
                    min: 0.05,
                    max: 1.2,
                },
                ChannelBounds {
                    min: 0.08,
                    max: 1.25,
                },
                ChannelBounds {
                    min: 0.12,
                    max: 1.35,
                },
            ],
        );

        let thin = luminance(*rendered.get_pixel(0, 0));
        let mid = luminance(*rendered.get_pixel(1, 0));
        let dense = luminance(*rendered.get_pixel(2, 0));

        for pixel in rendered.pixels() {
            for channel in pixel.channels() {
                assert!(channel.is_finite());
                assert!((0.0..=1.0).contains(channel));
            }
        }

        assert!(
            thin < mid,
            "denser color negative sample should render brighter than thin sample"
        );
        assert!(
            mid < dense,
            "densest color negative sample should render brightest"
        );

        let mid_pixel = rendered.get_pixel(1, 0).channels();
        let color_spread = (mid_pixel[0] - mid_pixel[2]).abs();
        assert!(
            color_spread > 0.01,
            "color fixture should preserve channel-specific response"
        );
    }

    #[test]
    fn black_and_white_negative_fixture_renders_neutral_monotonic_values() {
        let rendered = render_fixture(
            vec![
                0.78, 0.78, 0.78, //
                0.32, 0.32, 0.32, //
                0.08, 0.08, 0.08,
            ],
            NegativeConversionParams::default(),
            [
                ChannelBounds {
                    min: 0.05,
                    max: 1.2,
                },
                ChannelBounds {
                    min: 0.05,
                    max: 1.2,
                },
                ChannelBounds {
                    min: 0.05,
                    max: 1.2,
                },
            ],
        );

        let thin = luminance(*rendered.get_pixel(0, 0));
        let mid = luminance(*rendered.get_pixel(1, 0));
        let dense = luminance(*rendered.get_pixel(2, 0));

        assert!(
            thin < mid,
            "denser black-and-white sample should render brighter than thin sample"
        );
        assert!(
            mid < dense,
            "densest black-and-white sample should render brightest"
        );

        for pixel in rendered.pixels() {
            let channels = pixel.channels();
            let max_chroma_delta = (channels[0] - channels[1])
                .abs()
                .max((channels[1] - channels[2]).abs())
                .max((channels[0] - channels[2]).abs());

            assert!(
                max_chroma_delta <= 0.0001,
                "black-and-white fixture should remain neutral"
            );
        }
    }

    #[test]
    fn base_fog_strength_changes_thin_density_rendering() {
        let pixels = vec![
            0.72, 0.56, 0.38, //
            0.30, 0.22, 0.16, //
            0.08, 0.06, 0.04,
        ];
        let bounds = [
            ChannelBounds {
                min: 0.12,
                max: 1.2,
            },
            ChannelBounds {
                min: 0.16,
                max: 1.25,
            },
            ChannelBounds {
                min: 0.22,
                max: 1.35,
            },
        ];
        let corrected = render_fixture(pixels.clone(), NegativeConversionParams::default(), bounds);
        let uncorrected = render_fixture(
            pixels,
            NegativeConversionParams {
                base_fog_strength: 0.0,
                ..NegativeConversionParams::default()
            },
            bounds,
        );

        assert_ne!(
            corrected.get_pixel(0, 0).channels(),
            uncorrected.get_pixel(0, 0).channels()
        );
    }

    #[test]
    fn negative_preview_and_export_fixture_share_density_pipeline() {
        let input = DynamicImage::ImageRgb32F(
            Rgb32FImage::from_vec(
                4,
                2,
                vec![
                    0.92, 0.75, 0.42, 0.80, 0.58, 0.32, 0.44, 0.30, 0.18, 0.18, 0.12, 0.08, //
                    0.88, 0.70, 0.38, 0.68, 0.48, 0.26, 0.36, 0.24, 0.14, 0.12, 0.08, 0.05,
                ],
            )
            .unwrap(),
        );
        let params = NegativeConversionParams {
            red_weight: 1.07,
            green_weight: 0.96,
            blue_weight: 1.18,
            base_fog_strength: 1.0,
            base_fog_sample: Some(NegativeBaseFogSampleRect {
                x: 0.0,
                y: 0.0,
                width: 0.5,
                height: 1.0,
            }),
            exposure: 0.05,
            contrast: 1.1,
        };
        let rgb = input.to_rgb32f();
        let (width, height) = rgb.dimensions();
        let log_pixels: Vec<f32> = rgb
            .as_raw()
            .iter()
            .map(|&v| -v.clamp(1e-6, 1.0).log10())
            .collect();
        let export_bounds = analyze_bounds(
            &log_pixels,
            width as usize,
            height as usize,
            params.base_fog_sample,
        );

        let preview_render = run_pipeline(&input, &params, None).to_rgb32f();
        let export_render = run_pipeline(&input, &params, Some(export_bounds)).to_rgb32f();

        assert_images_near(&preview_render, &export_render);
        assert_ne!(
            preview_render.get_pixel(0, 0).channels(),
            preview_render.get_pixel(3, 1).channels()
        );
    }

    #[test]
    fn negative_density_cpu_report_proves_apply_capable_fixture_path() {
        let input = DynamicImage::ImageRgb32F(
            Rgb32FImage::from_vec(
                4,
                2,
                vec![
                    0.95, 0.83, 0.44, 0.88, 0.70, 0.38, 0.50, 0.31, 0.18, 0.08, 0.05, 0.03, //
                    0.92, 0.78, 0.38, 0.68, 0.48, 0.26, 0.32, 0.20, 0.12, 0.06, 0.04, 0.02,
                ],
            )
            .unwrap(),
        );
        let params = NegativeConversionParams {
            red_weight: 1.07,
            green_weight: 0.96,
            blue_weight: 1.18,
            base_fog_strength: 1.0,
            base_fog_sample: Some(NegativeBaseFogSampleRect {
                x: 0.0,
                y: 0.0,
                width: 0.5,
                height: 1.0,
            }),
            exposure: 0.05,
            contrast: 1.1,
        };
        let rendered = run_pipeline(&input, &params, None).to_rgb32f();
        let input_rgb = input.to_rgb32f();
        let input_to_output_delta = mean_abs_delta(&input_rgb, &rendered);
        let changed_pixel_count = rendered
            .pixels()
            .zip(input_rgb.pixels())
            .filter(|(rendered_pixel, input_pixel)| {
                rendered_pixel
                    .channels()
                    .iter()
                    .zip(input_pixel.channels())
                    .any(|(rendered_channel, input_channel)| {
                        (rendered_channel - input_channel).abs() > 0.01
                    })
            })
            .count();
        let monotonic_luma = luminance(*rendered.get_pixel(0, 0))
            < luminance(*rendered.get_pixel(1, 0))
            && luminance(*rendered.get_pixel(1, 0)) < luminance(*rendered.get_pixel(3, 0));

        assert!(input_to_output_delta > 0.05);
        assert!(changed_pixel_count > 0);
        assert!(monotonic_luma);

        if let Ok(report_path) = std::env::var("RAWENGINE_NEGATIVE_LAB_DENSITY_CPU_REPORT") {
            let report = json!({
                "algorithm": "density_rgb_v1",
                "artifactHash": hash_rendered_image(&rendered),
                "changedPixelCount": changed_pixel_count,
                "doesNotProve": [
                    "camera_raw_decode_path",
                    "automatic_base_fog_estimation",
                    "display_referred_input_accuracy",
                    "neutralization_accuracy",
                    "colorimetric_scene_reconstruction",
                    "roll_batch_execution",
                    "ui_app_server_e2e",
                    "commercial_converter_parity"
                ],
                "inputContract": "declared_linear_scan_rgb",
                "inputToOutputMeanAbsDelta": input_to_output_delta,
                "issue": 2343,
                "monotonicLuma": monotonic_luma,
                "outputDimensions": {
                    "height": rendered.height(),
                    "width": rendered.width()
                },
                "runtimeStatus": "cpu_apply_capable_fixture_path",
                "warningMode": "synthetic_linear_fixture_only"
            });
            fs::write(report_path, serde_json::to_vec_pretty(&report).unwrap())
                .expect("write Negative Lab density CPU report");
        }
    }

    #[test]
    fn negative_lab_public_scan_exports_positive_report_when_enabled() {
        if std::env::var("RAWENGINE_RUN_NEGATIVE_LAB_PUBLIC_EXPORT_PROOF")
            .ok()
            .as_deref()
            != Some("1")
        {
            eprintln!("skipping Negative Lab public export proof");
            return;
        }

        let report_path = std::env::var("RAWENGINE_NEGATIVE_LAB_PUBLIC_EXPORT_REPORT")
            .expect("RAWENGINE_NEGATIVE_LAB_PUBLIC_EXPORT_REPORT is required");
        let source_path =
            Path::new("../fixtures/negative-lab/public/110-format-ericht-negative-cc0-320.jpg");
        let output_dir = Path::new("target/negative-lab-public-export-proof");
        fs::create_dir_all(output_dir).expect("create Negative Lab public export proof dir");

        let input = image::open(source_path).expect("open public negative fixture");
        let applied_profile_id = "negative_lab.generic.c41.portrait.v1";
        let applied_profile_display_name = "C-41 Portrait";
        let applied_profile_claim_policy = "generic_starting_point_no_stock_claim";
        let applied_profile_does_not_prove = [
            "no_named_stock_emulation_claim",
            "no_colorimetric_match_claim",
            "not_measured_from_manufacturer_profile",
        ];
        let params = NegativeConversionParams {
            red_weight: 1.03,
            green_weight: 1.0,
            blue_weight: 0.98,
            base_fog_strength: 1.0,
            base_fog_sample: Some(NegativeBaseFogSampleRect {
                x: 0.0,
                y: 0.0,
                width: 0.35,
                height: 0.35,
            }),
            exposure: 0.05,
            contrast: 0.95,
        };
        let bounds_ref = downscale_f32_image(&input, 1080, 1080);
        let ref_rgb = bounds_ref.to_rgb32f();
        let (ref_w, ref_h) = ref_rgb.dimensions();
        let log_pixels: Vec<f32> = ref_rgb
            .as_raw()
            .iter()
            .map(|&value| -value.clamp(1e-6, 1.0).log10())
            .collect();
        let bounds = analyze_bounds(
            &log_pixels,
            ref_w as usize,
            ref_h as usize,
            params.base_fog_sample,
        );
        let rendered = run_pipeline(&input, &params, Some(bounds));
        let output_path = output_dir.join("110-format-ericht-negative-cc0-320-Positive.jpg");
        let mut buf = Cursor::new(Vec::new());
        rendered
            .to_rgb8()
            .write_with_encoder(JpegEncoder::new_with_quality(&mut buf, JPEG_PROOF_QUALITY))
            .expect("encode public negative positive JPEG");
        fs::write(&output_path, buf.into_inner()).expect("write public negative positive JPEG");

        let save_options = NegativeConversionSaveOptions {
            accepted_dry_run_plan_hash: Some("fnv1a32:2f4a91bc".to_string()),
            accepted_dry_run_plan_id: Some("negative_lab_batch_plan_2f4a91bc".to_string()),
            output_format: NegativeConversionOutputFormat::JpegProof,
            profile_provenance_hash: Some("fnv1a32:9d4a13c8".to_string()),
            suffix: "Positive".to_string(),
        };
        write_negative_lab_output_sidecar(
            &output_path,
            source_path,
            &params,
            &save_options,
            rendered.width(),
            rendered.height(),
        )
        .expect("write public negative positive sidecar");

        let input_rgb = input.to_rgb32f();
        let rendered_rgb = rendered.to_rgb32f();
        let changed_pixel_ratio = rendered_rgb
            .pixels()
            .zip(input_rgb.pixels())
            .filter(|(rendered_pixel, input_pixel)| {
                rendered_pixel
                    .channels()
                    .iter()
                    .zip(input_pixel.channels())
                    .any(|(rendered_channel, input_channel)| {
                        (rendered_channel - input_channel).abs() > 0.01
                    })
            })
            .count() as f32
            / (rendered.width() * rendered.height()).max(1) as f32;
        let input_to_output_delta = mean_abs_delta(&input_rgb, &rendered_rgb);

        assert!(changed_pixel_ratio > 0.05);
        assert!(input_to_output_delta > 0.01);

        let sidecar_path = negative_lab_output_sidecar_path(&output_path);
        assert!(
            sidecar_path.exists(),
            "Negative Lab public export proof must write a sidecar"
        );
        let report = json!({
            "algorithm": "density_rgb_v1",
            "appliedProfile": {
                "claimLevel": "generic_starting_point_only",
                "claimPolicy": applied_profile_claim_policy,
                "displayName": applied_profile_display_name,
                "doesNotProve": applied_profile_does_not_prove,
                "params": {
                    "base_fog_sample": {
                        "height": 0.35,
                        "width": 0.35,
                        "x": 0.0,
                        "y": 0.0
                    },
                    "base_fog_strength": params.base_fog_strength,
                    "blue_weight": params.blue_weight,
                    "contrast": params.contrast,
                    "exposure": params.exposure,
                    "green_weight": params.green_weight,
                    "red_weight": params.red_weight
                },
                "presetId": applied_profile_id,
                "processFamily": "c41_color_negative",
                "profileProvenanceHash": "fnv1a32:9d4a13c8",
                "runtimeStatus": "runtime_parameter_applied",
                "stockFamilyDescriptor": "Soft portrait color negative"
            },
            "doesNotProve": [
                "camera_raw_decode_path",
                "capture_one_class_quality",
                "commercial_converter_parity",
                "full_macos_app_manual_session",
                "icc_colorimetric_accuracy",
                "raw_scan_input",
                "stock_library_maturity"
            ],
            "fixtureId": "negative_lab.real.public.cc0_110_ericht_negative_001",
            "inputToOutputMeanAbsDelta": input_to_output_delta,
            "issue": 2311,
            "metrics": {
                "changedPixelRatio": changed_pixel_ratio,
                "inputToOutputMeanAbsDelta": input_to_output_delta
            },
            "output": {
                "contentHash": hash_negative_lab_output_file(&output_path).expect("hash output"),
                "dimensions": {
                    "height": rendered.height(),
                    "width": rendered.width()
                },
                "format": "jpeg_proof",
                "path": "src-tauri/target/negative-lab-public-export-proof/110-format-ericht-negative-cc0-320-Positive.jpg"
            },
            "runtimeStatus": "public_negative_scan_positive_export_rendered",
            "schemaVersion": 1,
            "sidecar": {
                "containsNegativeLabArtifact": true,
                "path": "src-tauri/target/negative-lab-public-export-proof/110-format-ericht-negative-cc0-320-Positive.jpg.rrdata",
                "runtimeGeneratedIds": true
            },
            "source": {
                "license": "CC0 public fixture",
                "manifest": "fixtures/negative-lab/public/110-format-ericht-negative-cc0-samples.json",
                "path": "fixtures/negative-lab/public/110-format-ericht-negative-cc0-320.jpg",
                "sha256": "sha256:f0913770ce2ec72f2261d6cc0948091e3224d11904049727a42beb864ef5673b"
            }
        });
        fs::write(report_path, serde_json::to_vec_pretty(&report).unwrap())
            .expect("write Negative Lab public export report");
    }

    #[test]
    fn sampled_base_fog_preview_export_acceptance_changes_render() {
        let input = DynamicImage::ImageRgb32F(
            Rgb32FImage::from_vec(
                6,
                2,
                vec![
                    0.95, 0.83, 0.44, 0.93, 0.80, 0.40, 0.56, 0.36, 0.20, 0.38, 0.23, 0.14, 0.21,
                    0.13, 0.08, 0.10, 0.06, 0.04, //
                    0.92, 0.78, 0.38, 0.89, 0.72, 0.34, 0.50, 0.31, 0.18, 0.32, 0.20, 0.12, 0.18,
                    0.11, 0.07, 0.08, 0.05, 0.03,
                ],
            )
            .unwrap(),
        );
        let sample_rect = NegativeBaseFogSampleRect {
            x: 0.0,
            y: 0.0,
            width: 0.34,
            height: 1.0,
        };
        let auto_estimate = estimate_base_fog_from_image(&input, None);
        let sampled_estimate = estimate_base_fog_from_image(&input, Some(sample_rect));
        let default_params = NegativeConversionParams::default();
        let auto_params = NegativeConversionParams {
            red_weight: auto_estimate.red_weight,
            green_weight: auto_estimate.green_weight,
            blue_weight: auto_estimate.blue_weight,
            base_fog_strength: 1.0,
            base_fog_sample: None,
            exposure: 0.0,
            contrast: 1.0,
        };
        let sampled_params = NegativeConversionParams {
            red_weight: sampled_estimate.red_weight,
            green_weight: sampled_estimate.green_weight,
            blue_weight: sampled_estimate.blue_weight,
            base_fog_strength: 1.0,
            base_fog_sample: Some(sample_rect),
            exposure: 0.0,
            contrast: 1.0,
        };
        let rgb = input.to_rgb32f();
        let (width, height) = rgb.dimensions();
        let log_pixels: Vec<f32> = rgb
            .as_raw()
            .iter()
            .map(|&value| -value.clamp(1e-6, 1.0).log10())
            .collect();
        let sampled_export_bounds = analyze_bounds(
            &log_pixels,
            width as usize,
            height as usize,
            sampled_params.base_fog_sample,
        );

        let default_preview = run_pipeline(&input, &default_params, None).to_rgb32f();
        let auto_preview = run_pipeline(&input, &auto_params, None).to_rgb32f();
        let sampled_preview = run_pipeline(&input, &sampled_params, None).to_rgb32f();
        let sampled_export =
            run_pipeline(&input, &sampled_params, Some(sampled_export_bounds)).to_rgb32f();

        assert!(
            mean_abs_delta(&default_preview, &auto_preview) > 0.01,
            "auto base/fog should visibly alter the preview render"
        );
        assert!(
            mean_abs_delta(&auto_preview, &sampled_preview) > 0.01,
            "sampled base/fog should visibly alter the accepted preview render"
        );
        assert_images_near(&sampled_preview, &sampled_export);
    }

    #[test]
    fn base_fog_estimate_returns_bounded_weights_and_confidence() {
        let input = DynamicImage::ImageRgb32F(
            Rgb32FImage::from_vec(
                3,
                2,
                vec![
                    0.90, 0.74, 0.42, 0.72, 0.50, 0.28, 0.40, 0.26, 0.14, //
                    0.88, 0.72, 0.40, 0.68, 0.46, 0.24, 0.36, 0.22, 0.12,
                ],
            )
            .unwrap(),
        );

        let estimate = estimate_base_fog_from_image(&input, None);
        assert!((MIN_CHANNEL_WEIGHT..=MAX_CHANNEL_WEIGHT).contains(&estimate.red_weight));
        assert!((MIN_CHANNEL_WEIGHT..=MAX_CHANNEL_WEIGHT).contains(&estimate.green_weight));
        assert!((MIN_CHANNEL_WEIGHT..=MAX_CHANNEL_WEIGHT).contains(&estimate.blue_weight));
        assert!((0.0..=1.0).contains(&estimate.confidence));
        assert_eq!(estimate.base_rgb.len(), 3);
        assert_eq!(estimate.base_density.len(), 3);
        for value in estimate.base_rgb {
            assert!((0.0..=1.0).contains(&value));
        }
        for value in estimate.base_density {
            assert!(value.is_finite());
            assert!(value >= 0.0);
        }
    }

    #[test]
    fn sampled_base_fog_estimate_uses_requested_patch() {
        let input = DynamicImage::ImageRgb32F(
            Rgb32FImage::from_vec(
                4,
                1,
                vec![
                    0.95, 0.82, 0.45, 0.95, 0.82, 0.45, 0.30, 0.28, 0.26, 0.28, 0.26, 0.24,
                ],
            )
            .unwrap(),
        );

        let full_frame = estimate_base_fog_from_image(&input, None);
        let right_patch = estimate_base_fog_from_image(
            &input,
            Some(NegativeBaseFogSampleRect {
                x: 0.5,
                y: 0.0,
                width: 0.5,
                height: 1.0,
            }),
        );

        assert_ne!(
            (
                full_frame.red_weight,
                full_frame.green_weight,
                full_frame.blue_weight
            ),
            (
                right_patch.red_weight,
                right_patch.green_weight,
                right_patch.blue_weight
            )
        );
    }
}
