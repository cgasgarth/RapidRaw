use crate::app_settings::load_settings_or_default;
use image::{GenericImageView, GrayImage, imageops};
use image_hasher::{HashAlg, HasherConfig};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;
use tauri::{AppHandle, Emitter};

use crate::image_loader;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CullingSettings {
    pub similarity_threshold: u32,
    pub blur_threshold: f64,
    pub group_similar: bool,
    pub filter_blurry: bool,
    #[serde(default)]
    pub rank_focus: bool,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImageAnalysisResult {
    pub path: String,
    pub quality_score: f64,
    pub sharpness_metric: f64,
    pub center_focus_metric: f64,
    pub face_sharpness_metric: f64,
    pub eye_sharpness_metric: f64,
    pub exposure_metric: f64,
    pub focus_score: f64,
    pub focus_confidence: f64,
    pub focus_region: String,
    pub focus_region_provider: String,
    pub detected_eye_confidence: Option<f64>,
    pub detected_face_confidence: Option<f64>,
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CullGroup {
    pub representative: ImageAnalysisResult,
    pub duplicates: Vec<ImageAnalysisResult>,
}

#[derive(Serialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct CullingSuggestions {
    pub similar_groups: Vec<CullGroup>,
    pub blurry_images: Vec<ImageAnalysisResult>,
    pub focus_rankings: Vec<ImageAnalysisResult>,
    pub failed_paths: Vec<String>,
    pub latency_report: Option<CullingLatencyReport>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CullingLatencyReport {
    pub analysis_mode_count: usize,
    pub average_analysis_ms: f64,
    pub failed_count: usize,
    pub max_analysis_ms: u128,
    pub source_count: usize,
    pub successful_count: usize,
    pub total_elapsed_ms: u128,
}

#[derive(Serialize, Clone)]
struct CullingProgress {
    current: usize,
    total: usize,
    stage: String,
}

struct ImageAnalysisData {
    analysis_duration_ms: u128,
    hash: image_hasher::ImageHash,
    result: ImageAnalysisResult,
}

const WEIGHT_SHARPNESS: f64 = 0.40;
const WEIGHT_CENTER_FOCUS: f64 = 0.35;
const WEIGHT_EXPOSURE: f64 = 0.25;
const FOCUS_REGION_EYE_BAND_HEURISTIC: &str = "eye_band_heuristic";
const FOCUS_REGION_LOCAL_FACE_EYE: &str = "local_face_eye_regions";
const FOCUS_REGION_PROVIDER_HEURISTIC: &str = "heuristic";
const FOCUS_REGION_PROVIDER_LOCAL_MANIFEST: &str = "local_manifest";
const MIN_DETECTED_REGION_CONFIDENCE: f64 = 0.5;

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct LocalFocusRegionManifest {
    provider: Option<String>,
    regions: Vec<LocalFocusRegion>,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct LocalFocusRegion {
    kind: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    confidence: f64,
}

struct FocusRegionMetrics {
    center: f64,
    face: f64,
    eye: f64,
    focus_region: String,
    focus_region_provider: String,
    detected_eye_confidence: Option<f64>,
    detected_face_confidence: Option<f64>,
}

fn clamp_unit(value: f64) -> f64 {
    value.clamp(0.0, 1.0)
}

fn normalize_focus_metric(metric: f64) -> f64 {
    clamp_unit((metric + 1.0).log10() / 3.5)
}

fn calculate_laplacian_variance(image: &GrayImage) -> f64 {
    let (width, height) = image.dimensions();
    if width < 3 || height < 3 {
        return 0.0;
    }

    let mut laplacian_values = Vec::with_capacity(((width - 2) * (height - 2)) as usize);
    let mut sum = 0.0;

    for y in 1..height - 1 {
        for x in 1..width - 1 {
            let p_center = image.get_pixel(x, y)[0] as i32;
            let p_north = image.get_pixel(x, y - 1)[0] as i32;
            let p_south = image.get_pixel(x, y + 1)[0] as i32;
            let p_west = image.get_pixel(x - 1, y)[0] as i32;
            let p_east = image.get_pixel(x + 1, y)[0] as i32;
            let conv_val = (p_north + p_south + p_west + p_east - 4 * p_center) as f64;
            laplacian_values.push(conv_val);
            sum += conv_val;
        }
    }

    if laplacian_values.is_empty() {
        return 0.0;
    }
    let mean = sum / laplacian_values.len() as f64;

    laplacian_values
        .iter()
        .map(|v| (v - mean).powi(2))
        .sum::<f64>()
        / laplacian_values.len() as f64
}

fn calculate_exposure_metric(image: &GrayImage) -> f64 {
    let histogram = imageproc::stats::histogram(image);
    let total_pixels = (image.width() * image.height()) as f64;
    if total_pixels == 0.0 {
        return 0.0;
    }

    let clip_threshold_dark = 5;
    let clip_threshold_bright = 250;

    let dark_pixels = histogram.channels[0][0..clip_threshold_dark]
        .iter()
        .sum::<u32>() as f64;
    let bright_pixels = histogram.channels[0][clip_threshold_bright..256]
        .iter()
        .sum::<u32>() as f64;

    let dark_clip_ratio = dark_pixels / total_pixels;
    let bright_clip_ratio = bright_pixels / total_pixels;

    let penalty = (dark_clip_ratio * 5.0) + (bright_clip_ratio * 5.0);

    (1.0f64 - penalty).max(0.0)
}

fn crop_laplacian_variance(image: &GrayImage, x: u32, y: u32, width: u32, height: u32) -> f64 {
    if width < 3 || height < 3 {
        return 0.0;
    }

    let crop = imageops::crop_imm(image, x, y, width, height).to_image();
    calculate_laplacian_variance(&crop)
}

fn focus_region_sidecar_candidates(path: &str) -> Vec<PathBuf> {
    let source_path = Path::new(path);
    let mut candidates = vec![PathBuf::from(format!("{path}.focus-regions.json"))];
    candidates.push(source_path.with_extension("focus-regions.json"));
    candidates
}

fn load_local_focus_region_manifest(path: &str) -> Option<LocalFocusRegionManifest> {
    focus_region_sidecar_candidates(path)
        .into_iter()
        .find(|candidate| candidate.is_file())
        .and_then(|candidate| std::fs::read(candidate).ok())
        .and_then(|bytes| serde_json::from_slice::<LocalFocusRegionManifest>(&bytes).ok())
}

fn best_detected_region<'a>(
    manifest: &'a LocalFocusRegionManifest,
    kind: &str,
) -> Option<&'a LocalFocusRegion> {
    manifest
        .regions
        .iter()
        .filter(|region| {
            region.kind.eq_ignore_ascii_case(kind)
                && region.confidence >= MIN_DETECTED_REGION_CONFIDENCE
                && region.width >= 3.0
                && region.height >= 3.0
        })
        .max_by(|left, right| {
            left.confidence
                .partial_cmp(&right.confidence)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
}

fn detected_region_laplacian_variance(
    image: &GrayImage,
    source_width: u32,
    source_height: u32,
    region: &LocalFocusRegion,
) -> Option<f64> {
    let (thumbnail_width, thumbnail_height) = image.dimensions();
    if source_width == 0 || source_height == 0 || thumbnail_width < 3 || thumbnail_height < 3 {
        return None;
    }

    let scale_x = thumbnail_width as f64 / source_width as f64;
    let scale_y = thumbnail_height as f64 / source_height as f64;
    let x = (region.x.max(0.0) * scale_x).floor() as u32;
    let y = (region.y.max(0.0) * scale_y).floor() as u32;
    let width = (region.width * scale_x).round().max(3.0) as u32;
    let height = (region.height * scale_y).round().max(3.0) as u32;

    if x >= thumbnail_width || y >= thumbnail_height {
        return None;
    }

    let width = width.min(thumbnail_width - x);
    let height = height.min(thumbnail_height - y);
    if width < 3 || height < 3 {
        return None;
    }

    Some(crop_laplacian_variance(image, x, y, width, height))
}

fn calculate_focus_region_metrics(
    image: &GrayImage,
    source_width: u32,
    source_height: u32,
    manifest: Option<&LocalFocusRegionManifest>,
) -> FocusRegionMetrics {
    let (width, height) = image.dimensions();
    if width < 6 || height < 6 {
        return FocusRegionMetrics {
            center: 0.0,
            face: 0.0,
            eye: 0.0,
            focus_region: FOCUS_REGION_EYE_BAND_HEURISTIC.to_string(),
            focus_region_provider: FOCUS_REGION_PROVIDER_HEURISTIC.to_string(),
            detected_eye_confidence: None,
            detected_face_confidence: None,
        };
    }

    let center = crop_laplacian_variance(image, width / 4, height / 4, width / 2, height / 2);

    let face_width = (width * 3 / 5).max(3).min(width);
    let face_height = (height * 3 / 5).max(3).min(height);
    let face_x = (width - face_width) / 2;
    let face_y = height / 6;
    let face_y = face_y.min(height.saturating_sub(face_height));
    let face = crop_laplacian_variance(image, face_x, face_y, face_width, face_height);

    let eye_width = (width / 2).max(3).min(width);
    let eye_height = (height / 5).max(3).min(height);
    let eye_x = (width - eye_width) / 2;
    let eye_y = height * 3 / 10;
    let eye_y = eye_y.min(height.saturating_sub(eye_height));
    let heuristic_eye = crop_laplacian_variance(image, eye_x, eye_y, eye_width, eye_height);

    let detected_face_region = manifest.and_then(|item| best_detected_region(item, "face"));
    let detected_eye_region = manifest.and_then(|item| best_detected_region(item, "eye"));
    let detected_face = detected_face_region.and_then(|region| {
        detected_region_laplacian_variance(image, source_width, source_height, region)
    });
    let detected_eye = detected_eye_region.and_then(|region| {
        detected_region_laplacian_variance(image, source_width, source_height, region)
    });

    let has_detected_region = detected_face.is_some() || detected_eye.is_some();
    FocusRegionMetrics {
        center,
        face: detected_face.unwrap_or(face),
        eye: detected_eye.unwrap_or(heuristic_eye),
        focus_region: if has_detected_region {
            FOCUS_REGION_LOCAL_FACE_EYE.to_string()
        } else {
            FOCUS_REGION_EYE_BAND_HEURISTIC.to_string()
        },
        focus_region_provider: if has_detected_region {
            manifest
                .and_then(|item| item.provider.clone())
                .unwrap_or_else(|| FOCUS_REGION_PROVIDER_LOCAL_MANIFEST.to_string())
        } else {
            FOCUS_REGION_PROVIDER_HEURISTIC.to_string()
        },
        detected_eye_confidence: detected_eye
            .is_some()
            .then(|| detected_eye_region.map(|region| region.confidence))
            .flatten(),
        detected_face_confidence: detected_face
            .is_some()
            .then(|| detected_face_region.map(|region| region.confidence))
            .flatten(),
    }
}

fn analyze_image(
    path: &str,
    hasher: &image_hasher::Hasher,
    settings: &crate::app_settings::AppSettings,
) -> Result<ImageAnalysisData, String> {
    const ANALYSIS_DIM: u32 = 720; // FIXME: How should we calculate good focus if it's downscaled?!?
    let file_bytes = std::fs::read(path).map_err(|e| e.to_string())?;

    let img = image_loader::load_base_image_from_bytes(&file_bytes, path, true, settings, None)
        .map_err(|e| e.to_string())?;

    let (width, height) = img.dimensions();
    let thumbnail = img.thumbnail(ANALYSIS_DIM, ANALYSIS_DIM);
    let gray_thumbnail = thumbnail.to_luma8();
    let local_focus_regions = load_local_focus_region_manifest(path);

    let sharpness_metric = calculate_laplacian_variance(&gray_thumbnail);
    let exposure_metric = calculate_exposure_metric(&gray_thumbnail);
    let focus_region_metrics = calculate_focus_region_metrics(
        &gray_thumbnail,
        width,
        height,
        local_focus_regions.as_ref(),
    );
    let center_focus_metric = focus_region_metrics.center;
    let face_sharpness_metric = focus_region_metrics.face;
    let eye_sharpness_metric = focus_region_metrics.eye;

    let normalized_sharpness = normalize_focus_metric(sharpness_metric);
    let normalized_center_focus = normalize_focus_metric(center_focus_metric);
    let normalized_face_sharpness = normalize_focus_metric(face_sharpness_metric);
    let normalized_eye_sharpness = normalize_focus_metric(eye_sharpness_metric);

    let quality_score = (normalized_sharpness * WEIGHT_SHARPNESS)
        + (normalized_center_focus * WEIGHT_CENTER_FOCUS)
        + (exposure_metric * WEIGHT_EXPOSURE);
    let focus_score = (normalized_eye_sharpness * 0.45)
        + (normalized_face_sharpness * 0.25)
        + (normalized_center_focus * 0.15)
        + (normalized_sharpness * 0.10)
        + (exposure_metric * 0.05);
    let region_consistency =
        clamp_unit(1.0 - ((normalized_eye_sharpness - normalized_face_sharpness).abs() * 0.35));
    let focus_confidence = clamp_unit(
        ((normalized_eye_sharpness * 0.60)
            + (normalized_face_sharpness * 0.20)
            + (normalized_center_focus * 0.10)
            + (exposure_metric * 0.10))
            * region_consistency,
    );

    let hash = hasher.hash_image(&thumbnail);

    Ok(ImageAnalysisData {
        analysis_duration_ms: 0,
        hash,
        result: ImageAnalysisResult {
            path: path.to_string(),
            quality_score,
            sharpness_metric,
            center_focus_metric,
            face_sharpness_metric,
            eye_sharpness_metric,
            exposure_metric,
            focus_score,
            focus_confidence,
            focus_region: focus_region_metrics.focus_region,
            focus_region_provider: focus_region_metrics.focus_region_provider,
            detected_eye_confidence: focus_region_metrics.detected_eye_confidence,
            detected_face_confidence: focus_region_metrics.detected_face_confidence,
            width,
            height,
        },
    })
}

#[tauri::command]
pub async fn cull_images(
    paths: Vec<String>,
    settings: CullingSettings,
    app_handle: AppHandle,
) -> Result<CullingSuggestions, String> {
    let started_at = Instant::now();
    if paths.is_empty() {
        return Ok(CullingSuggestions::default());
    }

    let app_settings = load_settings_or_default(&app_handle);

    let total_count = paths.len();
    let completed_count = Arc::new(AtomicUsize::new(0));
    let _ = app_handle.emit(crate::events::CULLING_START, total_count);

    let hasher = HasherConfig::new()
        .hash_alg(HashAlg::DoubleGradient)
        .hash_size(16, 16)
        .to_hasher();

    let analysis_results: Vec<Result<ImageAnalysisData, (String, String)>> = paths
        .par_iter()
        .map(|path| {
            let completed = completed_count.fetch_add(1, Ordering::Relaxed) + 1;
            let _ = app_handle.emit(
                "culling-progress",
                CullingProgress {
                    current: completed,
                    total: total_count,
                    stage: "Analyzing images...".to_string(),
                },
            );

            let image_started_at = Instant::now();
            analyze_image(path, &hasher, &app_settings)
                .map(|mut data| {
                    data.analysis_duration_ms = image_started_at.elapsed().as_millis();
                    data
                })
                .map_err(|e| (path.to_string(), e))
        })
        .collect();

    let mut successful_analyses = Vec::new();
    let mut failed_paths = Vec::new();
    for res in analysis_results {
        match res {
            Ok(data) => successful_analyses.push(data),
            Err((path, error)) => {
                eprintln!("Failed to analyze image {}: {}", path, error);
                failed_paths.push(path);
            }
        }
    }

    let _ = app_handle.emit(
        "culling-progress",
        CullingProgress {
            current: total_count,
            total: total_count,
            stage: "Grouping similar images...".to_string(),
        },
    );

    let mut suggestions = CullingSuggestions {
        failed_paths,
        ..Default::default()
    };
    let mut processed_indices = vec![false; successful_analyses.len()];

    if settings.group_similar {
        for i in 0..successful_analyses.len() {
            if processed_indices[i] {
                continue;
            }

            let mut current_group_indices = vec![];
            let mut queue = VecDeque::new();

            processed_indices[i] = true;
            current_group_indices.push(i);
            queue.push_back(i);

            while let Some(current_idx) = queue.pop_front() {
                for j in (current_idx + 1)..successful_analyses.len() {
                    if processed_indices[j] {
                        continue;
                    }

                    let dist = successful_analyses[current_idx]
                        .hash
                        .dist(&successful_analyses[j].hash);
                    if dist <= settings.similarity_threshold {
                        processed_indices[j] = true;
                        current_group_indices.push(j);
                        queue.push_back(j);
                    }
                }
            }

            if current_group_indices.len() > 1 {
                current_group_indices.sort_by(|&a, &b| {
                    successful_analyses[b]
                        .result
                        .quality_score
                        .partial_cmp(&successful_analyses[a].result.quality_score)
                        .unwrap_or(std::cmp::Ordering::Equal)
                });

                let representative_idx = current_group_indices[0];
                let duplicate_indices = &current_group_indices[1..];

                suggestions.similar_groups.push(CullGroup {
                    representative: successful_analyses[representative_idx].result.clone(),
                    duplicates: duplicate_indices
                        .iter()
                        .map(|&idx| successful_analyses[idx].result.clone())
                        .collect(),
                });
            }
        }
    }

    if settings.filter_blurry {
        for i in 0..successful_analyses.len() {
            if !processed_indices[i] {
                let item = &successful_analyses[i];
                if item.result.sharpness_metric < settings.blur_threshold {
                    suggestions.blurry_images.push(item.result.clone());
                }
            }
        }
        suggestions.blurry_images.sort_by(|a, b| {
            a.sharpness_metric
                .partial_cmp(&b.sharpness_metric)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
    }

    if settings.rank_focus {
        suggestions.focus_rankings = successful_analyses
            .iter()
            .map(|item| item.result.clone())
            .collect();
        suggestions.focus_rankings.sort_by(|a, b| {
            b.focus_score
                .partial_cmp(&a.focus_score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
    }

    let successful_count = successful_analyses.len();
    let total_analysis_ms: u128 = successful_analyses
        .iter()
        .map(|item| item.analysis_duration_ms)
        .sum();
    let max_analysis_ms = successful_analyses
        .iter()
        .map(|item| item.analysis_duration_ms)
        .max()
        .unwrap_or(0);
    let average_analysis_ms = if successful_count == 0 {
        0.0
    } else {
        total_analysis_ms as f64 / successful_count as f64
    };
    suggestions.latency_report = Some(CullingLatencyReport {
        analysis_mode_count: (settings.group_similar as usize)
            + (settings.filter_blurry as usize)
            + (settings.rank_focus as usize),
        average_analysis_ms,
        failed_count: suggestions.failed_paths.len(),
        max_analysis_ms,
        source_count: total_count,
        successful_count,
        total_elapsed_ms: started_at.elapsed().as_millis(),
    });

    let _ = app_handle.emit(crate::events::CULLING_COMPLETE, &suggestions);
    Ok(suggestions)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Luma;
    use serde::{Deserialize, Serialize};
    use sha2::{Digest, Sha256};
    use std::collections::{HashMap, HashSet};
    use std::fs;
    use std::path::{Path, PathBuf};

    const PRIVATE_CULLING_ARTIFACT_DIR: &str = "private-artifacts/validation/culling-focus-ranking";
    const PRIVATE_CULLING_LABELS_NAME: &str = "culling-focus-labels.json";
    const PRIVATE_CULLING_REPORT_NAME: &str = "culling-focus-ranking-report.json";
    const PRIVATE_CULLING_SOURCE_LIMIT: usize = 24;

    fn build_focus_fixture(focused_eye_band: bool) -> GrayImage {
        let mut image = GrayImage::from_pixel(128, 128, Luma([128]));
        for y in 16..96 {
            for x in 28..100 {
                let value = if focused_eye_band && (36..62).contains(&y) {
                    if ((x / 4) + (y / 4)) % 2 == 0 {
                        235
                    } else {
                        25
                    }
                } else {
                    128
                };
                image.put_pixel(x, y, Luma([value]));
            }
        }
        image
    }

    fn build_detected_region_fixture() -> GrayImage {
        let mut image = GrayImage::from_pixel(128, 128, Luma([128]));
        for y in 90..116 {
            for x in 8..48 {
                let value = if ((x / 3) + (y / 3)) % 2 == 0 {
                    245
                } else {
                    15
                };
                image.put_pixel(x, y, Luma([value]));
            }
        }
        image
    }

    fn write_focus_fixture(path: &std::path::Path, focused_eye_band: bool) {
        let image = build_focus_fixture(focused_eye_band);
        image.save(path).expect("write focus fixture");
    }

    #[test]
    fn focus_ranking_metrics_prefer_eye_band_detail_without_rejection() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let focused_path = temp_dir.path().join("focused.png");
        let soft_path = temp_dir.path().join("soft.png");
        write_focus_fixture(&focused_path, true);
        write_focus_fixture(&soft_path, false);

        let focused_metrics =
            calculate_focus_region_metrics(&build_focus_fixture(true), 128, 128, None);
        let soft_metrics =
            calculate_focus_region_metrics(&build_focus_fixture(false), 128, 128, None);
        assert!(focused_metrics.eye > soft_metrics.eye);
        assert!(focused_metrics.face > soft_metrics.face);

        let hasher = HasherConfig::new()
            .hash_alg(HashAlg::DoubleGradient)
            .hash_size(16, 16)
            .to_hasher();
        let settings = crate::app_settings::AppSettings::default();
        let focused = analyze_image(
            focused_path.to_str().expect("focused path"),
            &hasher,
            &settings,
        )
        .expect("focused analysis")
        .result;
        let soft = analyze_image(soft_path.to_str().expect("soft path"), &hasher, &settings)
            .expect("soft analysis")
            .result;

        assert_eq!(focused.focus_region, FOCUS_REGION_EYE_BAND_HEURISTIC);
        assert_eq!(
            focused.focus_region_provider,
            FOCUS_REGION_PROVIDER_HEURISTIC
        );
        assert!(focused.focus_score > soft.focus_score);
        assert!(focused.focus_confidence > soft.focus_confidence);
        assert!((0.0..=1.0).contains(&focused.focus_score));
        assert!((0.0..=1.0).contains(&focused.focus_confidence));
    }

    #[test]
    fn local_focus_region_manifest_overrides_eye_band_when_detected() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let image_path = temp_dir.path().join("detected.png");
        build_detected_region_fixture()
            .save(&image_path)
            .expect("write detected fixture");
        fs::write(
            format!("{}.focus-regions.json", image_path.display()),
            r#"{
              "provider": "unit-test-detector",
              "regions": [
                {"kind": "eye", "x": 8, "y": 90, "width": 40, "height": 26, "confidence": 0.92},
                {"kind": "face", "x": 4, "y": 84, "width": 54, "height": 38, "confidence": 0.81}
              ]
            }"#,
        )
        .expect("write focus sidecar");

        let hasher = HasherConfig::new()
            .hash_alg(HashAlg::DoubleGradient)
            .hash_size(16, 16)
            .to_hasher();
        let settings = crate::app_settings::AppSettings::default();
        let result = analyze_image(image_path.to_str().expect("image path"), &hasher, &settings)
            .expect("detected analysis")
            .result;

        assert_eq!(result.focus_region, FOCUS_REGION_LOCAL_FACE_EYE);
        assert_eq!(result.focus_region_provider, "unit-test-detector");
        assert_eq!(result.detected_eye_confidence, Some(0.92));
        assert_eq!(result.detected_face_confidence, Some(0.81));
        let heuristic_metrics =
            calculate_focus_region_metrics(&build_detected_region_fixture(), 128, 128, None);
        assert!(result.eye_sharpness_metric > heuristic_metrics.eye);
        assert!((0.0..=1.0).contains(&result.focus_score));
        assert!((0.0..=1.0).contains(&result.focus_confidence));
    }

    #[test]
    fn low_confidence_local_focus_regions_fall_back_to_heuristic() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let image_path = temp_dir.path().join("fallback.png");
        build_detected_region_fixture()
            .save(&image_path)
            .expect("write fallback fixture");
        fs::write(
            format!("{}.focus-regions.json", image_path.display()),
            r#"{
              "provider": "unit-test-detector",
              "regions": [
                {"kind": "eye", "x": 8, "y": 90, "width": 40, "height": 26, "confidence": 0.20}
              ]
            }"#,
        )
        .expect("write low-confidence sidecar");

        let hasher = HasherConfig::new()
            .hash_alg(HashAlg::DoubleGradient)
            .hash_size(16, 16)
            .to_hasher();
        let settings = crate::app_settings::AppSettings::default();
        let result = analyze_image(image_path.to_str().expect("image path"), &hasher, &settings)
            .expect("fallback analysis")
            .result;

        assert_eq!(result.focus_region, FOCUS_REGION_EYE_BAND_HEURISTIC);
        assert_eq!(
            result.focus_region_provider,
            FOCUS_REGION_PROVIDER_HEURISTIC
        );
        assert_eq!(result.detected_eye_confidence, None);
        assert_eq!(result.detected_face_confidence, None);
    }

    #[test]
    fn tiny_images_keep_focus_metrics_bounded() {
        let image = GrayImage::from_pixel(4, 4, image::Luma([128]));
        let metrics = calculate_focus_region_metrics(&image, 4, 4, None);

        assert_eq!(metrics.center, 0.0);
        assert_eq!(metrics.face, 0.0);
        assert_eq!(metrics.eye, 0.0);
        assert_eq!(metrics.focus_region, FOCUS_REGION_EYE_BAND_HEURISTIC);
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct PrivateCullingFocusReport {
        artifact_path: String,
        failed_paths: Vec<String>,
        issue: u32,
        labeled_evaluation: Option<PrivateCullingLabeledEvaluation>,
        latency_report: CullingLatencyReport,
        metrics: Vec<PrivateCullingMetric>,
        proof_claims: PrivateCullingProofClaims,
        rankings: Vec<PrivateCullingRanking>,
        source_count: usize,
        validation_mode: String,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct PrivateCullingLabelManifest {
        cases: Vec<PrivateCullingLabelCase>,
        dataset_id: String,
        label_source: String,
        schema_version: u32,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct PrivateCullingLabelCase {
        #[serde(default)]
        acceptable_best_paths: Vec<String>,
        case_id: String,
        expected_best_path: String,
        #[serde(default)]
        no_face_fallback_expected: bool,
        paths: Vec<String>,
        #[serde(default)]
        ranked_paths: Vec<String>,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct PrivateCullingLabeledEvaluation {
        case_results: Vec<PrivateCullingLabelCaseResult>,
        dataset_id: String,
        false_confidence_case_count: usize,
        label_source: String,
        labeled_case_count: usize,
        manifest_path: String,
        mean_reciprocal_rank: f64,
        mean_spearman_rank_correlation: Option<f64>,
        no_face_fallback_case_count: usize,
        no_face_fallback_match_count: usize,
        schema_version: u32,
        top_choice_accuracy: f64,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct PrivateCullingLabelCaseResult {
        acceptable_best_paths: Vec<String>,
        case_id: String,
        expected_best_path: String,
        expected_best_rank: Option<usize>,
        false_confidence: bool,
        no_face_fallback_expected: bool,
        no_face_fallback_matched: bool,
        predicted_confidence: Option<f64>,
        predicted_focus_region: Option<String>,
        predicted_top_path: Option<String>,
        reciprocal_rank: f64,
        spearman_rank_correlation: Option<f64>,
        top_choice_matched: bool,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct PrivateCullingMetric {
        name: String,
        passed: bool,
        threshold: f64,
        value: f64,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct PrivateCullingProofClaims {
        does_not_prove: Vec<String>,
        proves: Vec<String>,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct PrivateCullingRanking {
        center_focus_metric: f64,
        detected_eye_confidence: Option<f64>,
        detected_face_confidence: Option<f64>,
        exposure_metric: f64,
        face_sharpness_metric: f64,
        focus_confidence: f64,
        focus_region: String,
        focus_region_provider: String,
        focus_score: f64,
        analysis_duration_ms: u128,
        path: String,
        rank: usize,
        source_hash_after: String,
        source_hash_before: String,
        source_is_raw: bool,
    }

    #[test]
    fn private_runtime_smoke_generates_culling_focus_raw_report_when_enabled() {
        if std::env::var("RAWENGINE_RUN_PRIVATE_CULLING_FOCUS_RAW_PROOF")
            .ok()
            .as_deref()
            != Some("1")
        {
            eprintln!("skipping private culling focus RAW proof smoke");
            return;
        }

        let private_root = PathBuf::from(
            std::env::var("RAWENGINE_PRIVATE_RAW_ROOT")
                .unwrap_or_else(|_| "/tmp/rawengine-private-root".to_string()),
        );
        run_private_culling_focus_raw_proof(&private_root)
            .expect("private culling focus RAW proof runs");
    }

    fn run_private_culling_focus_raw_proof(private_root: &Path) -> Result<(), String> {
        let report_started_at = Instant::now();
        let source_paths = collect_raw_paths(private_root, PRIVATE_CULLING_SOURCE_LIMIT)?;
        let source_count = source_paths.len();
        if source_paths.len() < 2 {
            return Err(format!(
                "expected at least 2 RAW files under {}, found {}",
                private_root.display(),
                source_paths.len()
            ));
        }

        let hasher = HasherConfig::new()
            .hash_alg(HashAlg::DoubleGradient)
            .hash_size(16, 16)
            .to_hasher();
        let settings = crate::app_settings::AppSettings::default();
        let mut rankings = Vec::new();
        let mut failed_paths = Vec::new();
        for path in source_paths {
            let source_hash_before = sha256_file(&path)?;
            let path_string = path.to_string_lossy().to_string();
            let analysis_started_at = Instant::now();
            let result = match analyze_image(&path_string, &hasher, &settings) {
                Ok(analysis) => analysis.result,
                Err(error) => {
                    failed_paths.push(format!(
                        "{}: {error}",
                        relative_private_path(private_root, &path)
                    ));
                    continue;
                }
            };
            let analysis_duration_ms = analysis_started_at.elapsed().as_millis();
            let source_hash_after = sha256_file(&path)?;
            rankings.push(PrivateCullingRanking {
                analysis_duration_ms,
                center_focus_metric: result.center_focus_metric,
                detected_eye_confidence: result.detected_eye_confidence,
                detected_face_confidence: result.detected_face_confidence,
                exposure_metric: result.exposure_metric,
                face_sharpness_metric: result.face_sharpness_metric,
                focus_confidence: result.focus_confidence,
                focus_region: result.focus_region,
                focus_region_provider: result.focus_region_provider,
                focus_score: result.focus_score,
                path: relative_private_path(private_root, &path),
                rank: 0,
                source_hash_after,
                source_hash_before,
                source_is_raw: crate::formats::is_raw_file(&path_string),
            });
        }
        if rankings.len() < 2 {
            return Err(format!(
                "expected at least 2 decodable RAW files under {}, decoded {}, failures: {}",
                private_root.display(),
                rankings.len(),
                failed_paths.join("; ")
            ));
        }

        rankings.sort_by(|left, right| {
            right
                .focus_score
                .partial_cmp(&left.focus_score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        for (index, ranking) in rankings.iter_mut().enumerate() {
            ranking.rank = index + 1;
        }

        let sorted_descending = rankings
            .windows(2)
            .all(|window| window[0].focus_score >= window[1].focus_score);
        let bounded_scores = rankings.iter().all(|ranking| {
            (0.0..=1.0).contains(&ranking.focus_score)
                && (0.0..=1.0).contains(&ranking.focus_confidence)
        });
        let raw_sources = rankings.iter().all(|ranking| ranking.source_is_raw);
        let source_hashes_unchanged = rankings
            .iter()
            .all(|ranking| ranking.source_hash_before == ranking.source_hash_after);
        let known_focus_regions = rankings.iter().all(|ranking| {
            ranking.focus_region == FOCUS_REGION_EYE_BAND_HEURISTIC
                || ranking.focus_region == FOCUS_REGION_LOCAL_FACE_EYE
        });
        let detected_focus_region_count = rankings
            .iter()
            .filter(|ranking| ranking.focus_region == FOCUS_REGION_LOCAL_FACE_EYE)
            .count();
        let total_analysis_ms: u128 = rankings
            .iter()
            .map(|ranking| ranking.analysis_duration_ms)
            .sum();
        let max_analysis_ms = rankings
            .iter()
            .map(|ranking| ranking.analysis_duration_ms)
            .max()
            .unwrap_or(0);
        let average_analysis_ms = if rankings.is_empty() {
            0.0
        } else {
            total_analysis_ms as f64 / rankings.len() as f64
        };
        let latency_report = CullingLatencyReport {
            analysis_mode_count: 1,
            average_analysis_ms,
            failed_count: failed_paths.len(),
            max_analysis_ms,
            source_count,
            successful_count: rankings.len(),
            total_elapsed_ms: report_started_at.elapsed().as_millis(),
        };
        let labeled_evaluation = evaluate_private_culling_labels(private_root, &rankings)?;

        let mut metrics = vec![
            private_metric(
                "sourceCount",
                rankings.len() as f64,
                2.0,
                rankings.len() >= 2,
            ),
            private_metric(
                "focusScoreSortedDescending",
                if sorted_descending { 1.0 } else { 0.0 },
                1.0,
                sorted_descending,
            ),
            private_metric(
                "focusScoresBounded",
                if bounded_scores { 1.0 } else { 0.0 },
                1.0,
                bounded_scores,
            ),
            private_metric(
                "sourceHashesUnchanged",
                if source_hashes_unchanged { 1.0 } else { 0.0 },
                1.0,
                source_hashes_unchanged,
            ),
            private_metric(
                "allSourcesAreRaw",
                if raw_sources { 1.0 } else { 0.0 },
                1.0,
                raw_sources,
            ),
            private_metric(
                "knownFocusRegionDeclared",
                if known_focus_regions { 1.0 } else { 0.0 },
                1.0,
                known_focus_regions,
            ),
            private_metric(
                "detectedFocusRegionCount",
                detected_focus_region_count as f64,
                0.0,
                true,
            ),
            private_metric(
                "latencyReportIncludesAllSources",
                latency_report.source_count as f64,
                source_count as f64,
                latency_report.source_count == source_count,
            ),
            private_metric(
                "latencyReportHasSuccessfulSamples",
                latency_report.successful_count as f64,
                2.0,
                latency_report.successful_count >= 2,
            ),
        ];
        if let Some(evaluation) = labeled_evaluation.as_ref() {
            metrics.extend([
                private_metric(
                    "labeledCaseCount",
                    evaluation.labeled_case_count as f64,
                    1.0,
                    evaluation.labeled_case_count >= 1,
                ),
                private_metric(
                    "labeledTopChoiceAccuracy",
                    evaluation.top_choice_accuracy,
                    0.0,
                    true,
                ),
                private_metric(
                    "labeledMeanReciprocalRank",
                    evaluation.mean_reciprocal_rank,
                    0.0,
                    true,
                ),
                private_metric(
                    "labeledFalseConfidenceCases",
                    evaluation.false_confidence_case_count as f64,
                    0.0,
                    true,
                ),
                private_metric(
                    "noFaceFallbackMatches",
                    evaluation.no_face_fallback_match_count as f64,
                    evaluation.no_face_fallback_case_count as f64,
                    evaluation.no_face_fallback_match_count
                        == evaluation.no_face_fallback_case_count,
                ),
            ]);
            if let Some(correlation) = evaluation.mean_spearman_rank_correlation {
                metrics.push(private_metric(
                    "labeledMeanSpearmanRankCorrelation",
                    correlation,
                    -1.0,
                    true,
                ));
            }
        }

        let artifact_dir = private_root.join(PRIVATE_CULLING_ARTIFACT_DIR);
        fs::create_dir_all(&artifact_dir).map_err(|error| error.to_string())?;
        let artifact_path = artifact_dir.join(PRIVATE_CULLING_REPORT_NAME);
        let report = PrivateCullingFocusReport {
            artifact_path: format!("{PRIVATE_CULLING_ARTIFACT_DIR}/{PRIVATE_CULLING_REPORT_NAME}"),
            failed_paths,
            issue: 3399,
            labeled_evaluation,
            latency_report,
            metrics,
            proof_claims: PrivateCullingProofClaims {
                does_not_prove: vec![
                    "trained_face_or_eye_detection".to_string(),
                    "automatic_rejection_decisions".to_string(),
                    "macos_app_ui_e2e_session".to_string(),
                    "general_portrait_dataset_accuracy_without_a_private_label_manifest"
                        .to_string(),
                ],
                proves: vec![
                    "real_private_raw_decode_for_culling_focus_ranking".to_string(),
                    "focus_rankings_are_sorted_by_runtime_focus_score".to_string(),
                    "focus_score_and_confidence_are_bounded".to_string(),
                    "source_raw_files_are_not_mutated".to_string(),
                    "focus_region_provider_metadata_is_reported".to_string(),
                    "runtime_latency_report_is_emitted".to_string(),
                    "private_label_manifest_metrics_are_reported_when_present".to_string(),
                ],
            },
            source_count: rankings.len(),
            rankings,
            validation_mode: "private_raw_culling_focus_ranking_runtime".to_string(),
        };
        fs::write(
            &artifact_path,
            serde_json::to_vec_pretty(&report).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;

        assert!(report.metrics.iter().all(|metric| metric.passed));
        Ok(())
    }

    fn evaluate_private_culling_labels(
        private_root: &Path,
        rankings: &[PrivateCullingRanking],
    ) -> Result<Option<PrivateCullingLabeledEvaluation>, String> {
        let manifest_path = private_root
            .join(PRIVATE_CULLING_ARTIFACT_DIR)
            .join(PRIVATE_CULLING_LABELS_NAME);
        if !manifest_path.exists() {
            return Ok(None);
        }

        let manifest: PrivateCullingLabelManifest =
            serde_json::from_slice(&fs::read(&manifest_path).map_err(|error| error.to_string())?)
                .map_err(|error| format!("invalid private culling label manifest: {error}"))?;
        if manifest.schema_version != 1 {
            return Err(format!(
                "unsupported private culling label schema version {}",
                manifest.schema_version
            ));
        }

        let ranking_by_path: HashMap<&str, &PrivateCullingRanking> = rankings
            .iter()
            .map(|ranking| (ranking.path.as_str(), ranking))
            .collect();
        let mut case_results = Vec::new();
        let mut top_choice_matches = 0usize;
        let mut reciprocal_rank_sum = 0.0;
        let mut spearman_sum = 0.0;
        let mut spearman_count = 0usize;
        let mut false_confidence_case_count = 0usize;
        let mut no_face_fallback_case_count = 0usize;
        let mut no_face_fallback_match_count = 0usize;

        for case in &manifest.cases {
            let mut case_rankings: Vec<&PrivateCullingRanking> = case
                .paths
                .iter()
                .filter_map(|path| ranking_by_path.get(path.as_str()).copied())
                .collect();
            if case_rankings.is_empty() {
                return Err(format!(
                    "label case {} has no decoded ranked paths",
                    case.case_id
                ));
            }

            case_rankings.sort_by(|left, right| {
                right
                    .focus_score
                    .partial_cmp(&left.focus_score)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            let predicted_top = case_rankings.first().copied();
            let acceptable_best_paths = acceptable_best_paths(case);
            let expected_best_rank = case_rankings
                .iter()
                .position(|ranking| acceptable_best_paths.contains(ranking.path.as_str()))
                .map(|index| index + 1);
            let reciprocal_rank = expected_best_rank
                .map(|rank| 1.0 / rank as f64)
                .unwrap_or(0.0);
            let top_choice_matched = predicted_top
                .map(|ranking| acceptable_best_paths.contains(ranking.path.as_str()))
                .unwrap_or(false);
            if top_choice_matched {
                top_choice_matches += 1;
            }
            reciprocal_rank_sum += reciprocal_rank;

            let spearman_rank_correlation = if case.ranked_paths.len() >= 2 {
                let correlation = spearman_correlation(&case.ranked_paths, &case_rankings);
                if let Some(value) = correlation {
                    spearman_sum += value;
                    spearman_count += 1;
                }
                correlation
            } else {
                None
            };

            let no_face_fallback_matched = !case.no_face_fallback_expected
                || predicted_top
                    .map(|ranking| ranking.focus_region == FOCUS_REGION_EYE_BAND_HEURISTIC)
                    .unwrap_or(false);
            if case.no_face_fallback_expected {
                no_face_fallback_case_count += 1;
                if no_face_fallback_matched {
                    no_face_fallback_match_count += 1;
                }
            }

            let false_confidence = !top_choice_matched
                && predicted_top
                    .map(|ranking| ranking.focus_confidence >= 0.65)
                    .unwrap_or(false);
            if false_confidence {
                false_confidence_case_count += 1;
            }

            case_results.push(PrivateCullingLabelCaseResult {
                acceptable_best_paths: acceptable_best_paths
                    .into_iter()
                    .map(str::to_string)
                    .collect(),
                case_id: case.case_id.clone(),
                expected_best_path: case.expected_best_path.clone(),
                expected_best_rank,
                false_confidence,
                no_face_fallback_expected: case.no_face_fallback_expected,
                no_face_fallback_matched,
                predicted_confidence: predicted_top.map(|ranking| ranking.focus_confidence),
                predicted_focus_region: predicted_top.map(|ranking| ranking.focus_region.clone()),
                predicted_top_path: predicted_top.map(|ranking| ranking.path.clone()),
                reciprocal_rank,
                spearman_rank_correlation,
                top_choice_matched,
            });
        }

        let labeled_case_count = case_results.len();
        if labeled_case_count == 0 {
            return Err(
                "private culling label manifest must include at least one case".to_string(),
            );
        }

        Ok(Some(PrivateCullingLabeledEvaluation {
            case_results,
            dataset_id: manifest.dataset_id,
            false_confidence_case_count,
            label_source: manifest.label_source,
            labeled_case_count,
            manifest_path: format!("{PRIVATE_CULLING_ARTIFACT_DIR}/{PRIVATE_CULLING_LABELS_NAME}"),
            mean_reciprocal_rank: reciprocal_rank_sum / labeled_case_count as f64,
            mean_spearman_rank_correlation: if spearman_count == 0 {
                None
            } else {
                Some(spearman_sum / spearman_count as f64)
            },
            no_face_fallback_case_count,
            no_face_fallback_match_count,
            schema_version: manifest.schema_version,
            top_choice_accuracy: top_choice_matches as f64 / labeled_case_count as f64,
        }))
    }

    fn acceptable_best_paths(case: &PrivateCullingLabelCase) -> HashSet<&str> {
        let mut paths: HashSet<&str> = case
            .acceptable_best_paths
            .iter()
            .map(String::as_str)
            .collect();
        paths.insert(case.expected_best_path.as_str());
        paths
    }

    fn spearman_correlation(
        expected_paths: &[String],
        predicted_rankings: &[&PrivateCullingRanking],
    ) -> Option<f64> {
        let predicted_rank_by_path: HashMap<&str, usize> = predicted_rankings
            .iter()
            .enumerate()
            .map(|(index, ranking)| (ranking.path.as_str(), index + 1))
            .collect();
        let pairs: Vec<(f64, f64)> = expected_paths
            .iter()
            .enumerate()
            .filter_map(|(index, path)| {
                predicted_rank_by_path
                    .get(path.as_str())
                    .map(|predicted_rank| ((index + 1) as f64, *predicted_rank as f64))
            })
            .collect();
        if pairs.len() < 2 {
            return None;
        }

        let expected_mean =
            pairs.iter().map(|(expected, _)| expected).sum::<f64>() / pairs.len() as f64;
        let predicted_mean =
            pairs.iter().map(|(_, predicted)| predicted).sum::<f64>() / pairs.len() as f64;
        let numerator = pairs
            .iter()
            .map(|(expected, predicted)| (expected - expected_mean) * (predicted - predicted_mean))
            .sum::<f64>();
        let expected_denominator = pairs
            .iter()
            .map(|(expected, _)| (expected - expected_mean).powi(2))
            .sum::<f64>()
            .sqrt();
        let predicted_denominator = pairs
            .iter()
            .map(|(_, predicted)| (predicted - predicted_mean).powi(2))
            .sum::<f64>()
            .sqrt();
        let denominator = expected_denominator * predicted_denominator;
        if denominator <= f64::EPSILON {
            None
        } else {
            Some(numerator / denominator)
        }
    }

    fn collect_raw_paths(root: &Path, limit: usize) -> Result<Vec<PathBuf>, String> {
        let mut paths = Vec::new();
        collect_raw_paths_into(root, &mut paths)?;
        paths.sort();
        paths.truncate(limit);
        Ok(paths)
    }

    fn collect_raw_paths_into(root: &Path, paths: &mut Vec<PathBuf>) -> Result<(), String> {
        for entry in fs::read_dir(root).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            if path.is_dir() {
                collect_raw_paths_into(&path, paths)?;
            } else if crate::formats::is_raw_file(&path) {
                paths.push(path);
            }
        }
        Ok(())
    }

    fn relative_private_path(root: &Path, path: &Path) -> String {
        path.strip_prefix(root)
            .unwrap_or(path)
            .to_string_lossy()
            .to_string()
    }

    fn sha256_file(path: &Path) -> Result<String, String> {
        let bytes = fs::read(path).map_err(|error| error.to_string())?;
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        Ok(format!("sha256:{}", hex::encode(hasher.finalize())))
    }

    fn private_metric(
        name: &str,
        value: f64,
        threshold: f64,
        passed: bool,
    ) -> PrivateCullingMetric {
        PrivateCullingMetric {
            name: name.to_string(),
            passed,
            threshold,
            value,
        }
    }
}
