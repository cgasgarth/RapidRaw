use crate::app_settings::load_settings_or_default;
use image::{GenericImageView, GrayImage, imageops};
use image_hasher::{HashAlg, HasherConfig};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
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
}

#[derive(Serialize, Clone)]
struct CullingProgress {
    current: usize,
    total: usize,
    stage: String,
}

struct ImageAnalysisData {
    hash: image_hasher::ImageHash,
    result: ImageAnalysisResult,
}

const WEIGHT_SHARPNESS: f64 = 0.40;
const WEIGHT_CENTER_FOCUS: f64 = 0.35;
const WEIGHT_EXPOSURE: f64 = 0.25;
const FOCUS_REGION_EYE_BAND_HEURISTIC: &str = "eye_band_heuristic";

struct FocusRegionMetrics {
    center: f64,
    face: f64,
    eye: f64,
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

fn calculate_focus_region_metrics(image: &GrayImage) -> FocusRegionMetrics {
    let (width, height) = image.dimensions();
    if width < 6 || height < 6 {
        return FocusRegionMetrics {
            center: 0.0,
            face: 0.0,
            eye: 0.0,
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
    let eye = crop_laplacian_variance(image, eye_x, eye_y, eye_width, eye_height);

    FocusRegionMetrics { center, face, eye }
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

    let sharpness_metric = calculate_laplacian_variance(&gray_thumbnail);
    let exposure_metric = calculate_exposure_metric(&gray_thumbnail);
    let focus_region_metrics = calculate_focus_region_metrics(&gray_thumbnail);
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
            focus_region: FOCUS_REGION_EYE_BAND_HEURISTIC.to_string(),
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

            analyze_image(path, &hasher, &app_settings).map_err(|e| (path.to_string(), e))
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

    let _ = app_handle.emit(crate::events::CULLING_COMPLETE, &suggestions);
    Ok(suggestions)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Luma;
    use serde::Serialize;
    use sha2::{Digest, Sha256};
    use std::fs;
    use std::path::{Path, PathBuf};

    const PRIVATE_CULLING_ARTIFACT_DIR: &str = "private-artifacts/validation/culling-focus-ranking";
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

        let focused_metrics = calculate_focus_region_metrics(&build_focus_fixture(true));
        let soft_metrics = calculate_focus_region_metrics(&build_focus_fixture(false));
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
        assert!(focused.focus_score > soft.focus_score);
        assert!(focused.focus_confidence > soft.focus_confidence);
        assert!((0.0..=1.0).contains(&focused.focus_score));
        assert!((0.0..=1.0).contains(&focused.focus_confidence));
    }

    #[test]
    fn tiny_images_keep_focus_metrics_bounded() {
        let image = GrayImage::from_pixel(4, 4, image::Luma([128]));
        let metrics = calculate_focus_region_metrics(&image);

        assert_eq!(metrics.center, 0.0);
        assert_eq!(metrics.face, 0.0);
        assert_eq!(metrics.eye, 0.0);
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct PrivateCullingFocusReport {
        artifact_path: String,
        failed_paths: Vec<String>,
        issue: u32,
        metrics: Vec<PrivateCullingMetric>,
        proof_claims: PrivateCullingProofClaims,
        rankings: Vec<PrivateCullingRanking>,
        source_count: usize,
        validation_mode: String,
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
        exposure_metric: f64,
        face_sharpness_metric: f64,
        focus_confidence: f64,
        focus_region: String,
        focus_score: f64,
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
        let source_paths = collect_raw_paths(private_root, PRIVATE_CULLING_SOURCE_LIMIT)?;
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
            let source_hash_after = sha256_file(&path)?;
            rankings.push(PrivateCullingRanking {
                center_focus_metric: result.center_focus_metric,
                exposure_metric: result.exposure_metric,
                face_sharpness_metric: result.face_sharpness_metric,
                focus_confidence: result.focus_confidence,
                focus_region: result.focus_region,
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
        let heuristic_regions = rankings
            .iter()
            .all(|ranking| ranking.focus_region == FOCUS_REGION_EYE_BAND_HEURISTIC);

        let metrics = vec![
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
                "heuristicFocusRegionDeclared",
                if heuristic_regions { 1.0 } else { 0.0 },
                1.0,
                heuristic_regions,
            ),
        ];

        let artifact_dir = private_root.join(PRIVATE_CULLING_ARTIFACT_DIR);
        fs::create_dir_all(&artifact_dir).map_err(|error| error.to_string())?;
        let artifact_path = artifact_dir.join(PRIVATE_CULLING_REPORT_NAME);
        let report = PrivateCullingFocusReport {
            artifact_path: format!("{PRIVATE_CULLING_ARTIFACT_DIR}/{PRIVATE_CULLING_REPORT_NAME}"),
            failed_paths,
            issue: 3267,
            metrics,
            proof_claims: PrivateCullingProofClaims {
                does_not_prove: vec![
                    "trained_face_or_eye_detection".to_string(),
                    "automatic_rejection_decisions".to_string(),
                    "macos_app_ui_e2e_session".to_string(),
                    "portrait_dataset_accuracy".to_string(),
                ],
                proves: vec![
                    "real_private_raw_decode_for_culling_focus_ranking".to_string(),
                    "focus_rankings_are_sorted_by_runtime_focus_score".to_string(),
                    "focus_score_and_confidence_are_bounded".to_string(),
                    "source_raw_files_are_not_mutated".to_string(),
                    "focus_region_is_declared_as_heuristic".to_string(),
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
