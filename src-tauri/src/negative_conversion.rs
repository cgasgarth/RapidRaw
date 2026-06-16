use crate::file_management::{parse_virtual_path, read_file_mapped};
use crate::image_loader::load_base_image_from_bytes;
use base64::{Engine as _, engine::general_purpose};
use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, Rgb32FImage};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::Cursor;
use std::path::Path;
use tauri::AppHandle;

use crate::AppState;
use crate::image_processing::downscale_f32_image;
use crate::load_settings;
use tauri::Emitter;

#[derive(Serialize, Deserialize, Debug, Clone, Copy)]
pub struct NegativeConversionParams {
    pub red_weight: f32,
    pub green_weight: f32,
    pub blue_weight: f32,

    #[serde(default = "default_base_fog_strength")]
    pub base_fog_strength: f32,
    pub exposure: f32,
    pub contrast: f32,
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
}

#[derive(Serialize, Debug, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct NegativeBaseFogEstimate {
    pub red_weight: f32,
    pub green_weight: f32,
    pub blue_weight: f32,
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
        }
    }
}

impl NegativeConversionSaveOptions {
    fn sanitized(self) -> Self {
        let suffix = sanitize_output_suffix(&self.suffix);

        Self {
            output_format: self.output_format,
            suffix,
        }
    }
}

impl Default for NegativeConversionParams {
    fn default() -> Self {
        Self {
            red_weight: 1.0,
            green_weight: 1.0,
            blue_weight: 1.0,
            base_fog_strength: default_base_fog_strength(),
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

fn analyze_bounds(log_data: &[f32], width: usize, height: usize) -> [ChannelBounds; 3] {
    let margin_x = (width as f32 * 0.12) as usize;
    let margin_y = (height as f32 * 0.12) as usize;

    let est_pixels = (width.saturating_sub(margin_x * 2)) * (height.saturating_sub(margin_y * 2));
    let step = (est_pixels / 40_000).max(1);

    let mut r_vals = Vec::with_capacity(est_pixels / step);
    let mut g_vals = Vec::with_capacity(est_pixels / step);
    let mut b_vals = Vec::with_capacity(est_pixels / step);

    for y in (margin_y..(height - margin_y)).step_by(3) {
        let row_offset = y * width * 3;

        for x in (margin_x..(width - margin_x)).step_by(step) {
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

fn estimate_base_fog_from_image(input: &DynamicImage) -> NegativeBaseFogEstimate {
    let rgb = input.to_rgb32f();
    let (width, height) = rgb.dimensions();
    let log_pixels: Vec<f32> = rgb
        .as_raw()
        .par_iter()
        .map(|&v| -v.clamp(1e-6, 1.0).log10())
        .collect();
    let bounds = analyze_bounds(&log_pixels, width as usize, height as usize);

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
        analyze_bounds(&log_pixels, width as usize, height as usize)
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
                        let settings = load_settings(app_handle.clone()).unwrap_or_default();

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
                    let settings = load_settings(app_handle.clone()).unwrap_or_default();

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
    Ok(format!("data:image/jpeg;base64,{}", base64_str))
}

#[tauri::command]
pub async fn estimate_negative_base_fog(
    path: String,
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
                let settings = load_settings(app_handle.clone()).unwrap_or_default();
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
            let settings = load_settings(app_handle.clone()).unwrap_or_default();
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
    Ok(estimate_base_fog_from_image(&downscaled))
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

            let settings = load_settings(app_handle.clone()).unwrap_or_default();

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
            let bounds = analyze_bounds(&log_pixels, ref_w as usize, ref_h as usize);

            let processed = run_pipeline(&img, &params, Some(bounds));

            let p = Path::new(&real_path);
            let parent = p.parent().unwrap_or(Path::new(""));
            let stem = p.file_stem().unwrap_or_default().to_string_lossy();
            let extension = match save_options.output_format {
                NegativeConversionOutputFormat::JpegProof => "jpg",
                NegativeConversionOutputFormat::Tiff16 => "tiff",
            };
            let filename = format!("{}_{}.{}", stem, save_options.suffix, extension);
            let out_path = parent.join(&filename);

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

    #[test]
    fn negative_conversion_params_clamp_to_supported_api_range() {
        let sanitized = NegativeConversionParams {
            red_weight: f32::NAN,
            green_weight: 99.0,
            blue_weight: -99.0,
            base_fog_strength: f32::NAN,
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
            output_format: NegativeConversionOutputFormat::JpegProof,
            suffix: " Proof / Final:01 ".to_string(),
        }
        .sanitized();

        assert!(matches!(
            sanitized.output_format,
            NegativeConversionOutputFormat::JpegProof
        ));
        assert_eq!(sanitized.suffix, "_Proof__Final01_");
    }

    #[test]
    fn negative_conversion_save_options_default_empty_suffix() {
        let sanitized = NegativeConversionSaveOptions {
            output_format: NegativeConversionOutputFormat::Tiff16,
            suffix: "///".to_string(),
        }
        .sanitized();

        assert_eq!(sanitized.suffix, DEFAULT_OUTPUT_SUFFIX);
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

        let estimate = estimate_base_fog_from_image(&input);
        assert!((MIN_CHANNEL_WEIGHT..=MAX_CHANNEL_WEIGHT).contains(&estimate.red_weight));
        assert!((MIN_CHANNEL_WEIGHT..=MAX_CHANNEL_WEIGHT).contains(&estimate.green_weight));
        assert!((MIN_CHANNEL_WEIGHT..=MAX_CHANNEL_WEIGHT).contains(&estimate.blue_weight));
        assert!((0.0..=1.0).contains(&estimate.confidence));
    }
}
