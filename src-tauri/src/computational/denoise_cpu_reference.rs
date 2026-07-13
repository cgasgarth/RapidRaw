use image::Rgb32FImage;
use rayon::prelude::*;
use serde::Serialize;

const DENOISE_IMPLEMENTATION_VERSION: u32 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DenoiseSourceClass {
    BayerRaw,
    EncodedRgb,
    LinearRaw,
    XTransRaw,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoiseBandEstimates {
    pub highlights: f32,
    pub midtones: f32,
    pub shadows: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoiseProfilePlanV1 {
    pub confidence: f32,
    pub implementation_version: u32,
    pub measured_noise_by_exposure_band: NoiseBandEstimates,
    pub sample_count: u32,
    pub source_class: DenoiseSourceClass,
}

#[derive(Debug, Clone, Copy)]
pub struct DenoiseCpuReferenceSettings {
    pub luma_strength: f32,
    pub chroma_strength: f32,
    pub edge_threshold: f32,
    pub contrast_protection: f32,
    pub detail: f32,
    pub natural_grain: f32,
    pub shadow_bias: f32,
}

impl DenoiseCpuReferenceSettings {
    pub fn from_intensity(intensity: f32) -> Self {
        let strength = intensity.clamp(0.0, 1.0);
        Self {
            luma_strength: strength * 0.32,
            chroma_strength: strength * 0.52,
            edge_threshold: 0.018 + (1.0 - strength) * 0.045,
            contrast_protection: 0.5,
            detail: 0.5,
            natural_grain: 0.0,
            shadow_bias: 0.0,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct YcPixel {
    y: f32,
    cb: f32,
    cr: f32,
}

#[derive(Debug, Clone, Copy, Default)]
struct NoiseAccumulator {
    count: u32,
    residual_sum_sq: f64,
}

impl NoiseAccumulator {
    fn add(&mut self, residual: f32) {
        self.count = self.count.saturating_add(1);
        self.residual_sum_sq += f64::from(residual * residual);
    }

    fn sigma(self, fallback: f32) -> f32 {
        if self.count == 0 {
            return fallback;
        }
        (self.residual_sum_sq / f64::from(self.count)).sqrt() as f32
    }
}

pub fn analyze_noise_profile(
    image: &Rgb32FImage,
    source_class: DenoiseSourceClass,
) -> NoiseProfilePlanV1 {
    let width = image.width() as usize;
    let height = image.height() as usize;
    if width < 3 || height < 3 {
        return NoiseProfilePlanV1 {
            confidence: 0.0,
            implementation_version: DENOISE_IMPLEMENTATION_VERSION,
            measured_noise_by_exposure_band: NoiseBandEstimates {
                highlights: 0.01,
                midtones: 0.012,
                shadows: 0.018,
            },
            sample_count: 0,
            source_class,
        };
    }

    let source = image
        .pixels()
        .map(|pixel| rgb_to_yc(pixel[0], pixel[1], pixel[2]))
        .collect::<Vec<_>>();
    let mut bands = [NoiseAccumulator::default(); 3];
    for y in 1..height - 1 {
        for x in 1..width - 1 {
            let index = y * width + x;
            let center = source[index].y;
            let left = source[index - 1].y;
            let right = source[index + 1].y;
            let top = source[index - width].y;
            let bottom = source[index + width].y;
            let gradient = (right - left).abs().max((bottom - top).abs());
            if gradient > 0.035 {
                continue;
            }
            let local_mean = (left + right + top + bottom) * 0.25;
            let band = if center < 0.18 {
                0
            } else if center < 0.65 {
                1
            } else {
                2
            };
            bands[band].add(center - local_mean);
        }
    }

    let sample_count = bands.iter().map(|band| band.count).sum::<u32>();
    let target_samples = ((width * height) as f32 * 0.08).max(32.0);
    NoiseProfilePlanV1 {
        confidence: (sample_count as f32 / target_samples).clamp(0.0, 1.0),
        implementation_version: DENOISE_IMPLEMENTATION_VERSION,
        measured_noise_by_exposure_band: NoiseBandEstimates {
            highlights: bands[2].sigma(0.01),
            midtones: bands[1].sigma(0.012),
            shadows: bands[0].sigma(0.018),
        },
        sample_count,
        source_class,
    }
}

pub fn apply_cpu_reference_denoise(
    image: &Rgb32FImage,
    settings: DenoiseCpuReferenceSettings,
) -> Rgb32FImage {
    let profile = analyze_noise_profile(image, DenoiseSourceClass::EncodedRgb);
    apply_cpu_reference_denoise_with_profile(image, settings, &profile)
}

pub fn apply_cpu_reference_denoise_with_profile(
    image: &Rgb32FImage,
    settings: DenoiseCpuReferenceSettings,
    profile: &NoiseProfilePlanV1,
) -> Rgb32FImage {
    let width = image.width() as usize;
    let height = image.height() as usize;
    if width == 0
        || height == 0
        || (settings.luma_strength <= f32::EPSILON && settings.chroma_strength <= f32::EPSILON)
    {
        return image.clone();
    }

    let source: Vec<YcPixel> = image
        .pixels()
        .map(|pixel| rgb_to_yc(pixel[0], pixel[1], pixel[2]))
        .collect();

    let mut output = vec![0.0_f32; width * height * 3];
    output
        .par_chunks_mut(3)
        .enumerate()
        .for_each(|(index, out)| {
            let x = index % width;
            let y = index / width;
            let center = source[index];
            let noise_sigma = noise_sigma_for_luma(profile, center.y);
            let filtered = edge_aware_average(&source, width, height, x, y, settings, noise_sigma);
            let edge_guard = local_edge_guard(
                &source,
                width,
                height,
                x,
                y,
                settings.edge_threshold.max(noise_sigma * 2.5),
            );
            let detail_protection = (0.35 + settings.detail.clamp(0.0, 1.0) * 0.6)
                * settings.contrast_protection.clamp(0.0, 1.0);
            let shadow_weight = 1.0
                + settings.shadow_bias.clamp(-1.0, 1.0) * (1.0 - smoothstep(0.08, 0.55, center.y));
            let luma_mix =
                (settings.luma_strength * shadow_weight * (1.0 - detail_protection * edge_guard))
                    .clamp(0.0, 1.0);
            let chroma_mix =
                (settings.chroma_strength * shadow_weight * 0.6 * (1.0 - 0.55 * edge_guard))
                    .clamp(0.0, 1.0);
            let denoised_y = lerp(center.y, filtered.y, luma_mix);
            let out_y = lerp(
                denoised_y,
                center.y,
                settings.natural_grain.clamp(0.0, 1.0) * settings.luma_strength.clamp(0.0, 1.0),
            );
            let out_cb = lerp(center.cb, filtered.cb, chroma_mix);
            let out_cr = lerp(center.cr, filtered.cr, chroma_mix);
            let (r, g, b) = yc_to_rgb(out_y, out_cb, out_cr);
            out[0] = r;
            out[1] = g;
            out[2] = b;
        });

    Rgb32FImage::from_raw(image.width(), image.height(), output).unwrap_or_else(|| image.clone())
}

fn edge_aware_average(
    source: &[YcPixel],
    width: usize,
    height: usize,
    x: usize,
    y: usize,
    settings: DenoiseCpuReferenceSettings,
    noise_sigma: f32,
) -> YcPixel {
    let center = source[y * width + x];
    let radius = 2_i32;
    let sigma_y = settings.edge_threshold.max(noise_sigma * 2.5).max(0.006);
    let inv_two_sigma_y_sq = 1.0 / (2.0 * sigma_y * sigma_y);
    let mut y_sum = 0.0;
    let mut cb_sum = 0.0;
    let mut cr_sum = 0.0;
    let mut weight_sum = 0.0;

    for dy in -radius..=radius {
        let sy = y as i32 + dy;
        if sy < 0 || sy >= height as i32 {
            continue;
        }
        for dx in -radius..=radius {
            let sx = x as i32 + dx;
            if sx < 0 || sx >= width as i32 {
                continue;
            }
            let neighbor = source[sy as usize * width + sx as usize];
            let distance_sq = (dx * dx + dy * dy) as f32;
            let spatial_weight = 1.0 / (1.0 + distance_sq);
            let y_diff = center.y - neighbor.y;
            let range_weight = (-(y_diff * y_diff) * inv_two_sigma_y_sq).exp();
            let weight = spatial_weight * range_weight;
            y_sum += neighbor.y * weight;
            cb_sum += neighbor.cb * weight;
            cr_sum += neighbor.cr * weight;
            weight_sum += weight;
        }
    }

    if weight_sum <= f32::EPSILON {
        return center;
    }

    let inv = 1.0 / weight_sum;
    YcPixel {
        y: y_sum * inv,
        cb: cb_sum * inv,
        cr: cr_sum * inv,
    }
}

fn noise_sigma_for_luma(profile: &NoiseProfilePlanV1, luma: f32) -> f32 {
    if luma < 0.18 {
        profile.measured_noise_by_exposure_band.shadows
    } else if luma < 0.65 {
        profile.measured_noise_by_exposure_band.midtones
    } else {
        profile.measured_noise_by_exposure_band.highlights
    }
}

fn smoothstep(edge0: f32, edge1: f32, value: f32) -> f32 {
    let t = ((value - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn local_edge_guard(
    source: &[YcPixel],
    width: usize,
    height: usize,
    x: usize,
    y: usize,
    edge_threshold: f32,
) -> f32 {
    let center = source[y * width + x].y;
    let mut max_delta: f32 = 0.0;
    if x > 0 {
        max_delta = max_delta.max((center - source[y * width + x - 1].y).abs());
    }
    if x + 1 < width {
        max_delta = max_delta.max((center - source[y * width + x + 1].y).abs());
    }
    if y > 0 {
        max_delta = max_delta.max((center - source[(y - 1) * width + x].y).abs());
    }
    if y + 1 < height {
        max_delta = max_delta.max((center - source[(y + 1) * width + x].y).abs());
    }
    (max_delta / edge_threshold.max(0.001)).clamp(0.0, 1.0)
}

#[inline]
fn lerp(a: f32, b: f32, amount: f32) -> f32 {
    a + (b - a) * amount.clamp(0.0, 1.0)
}

#[inline]
fn rgb_to_yc(r: f32, g: f32, b: f32) -> YcPixel {
    YcPixel {
        y: 0.299 * r + 0.587 * g + 0.114 * b,
        cb: -0.168736 * r - 0.331264 * g + 0.5 * b,
        cr: 0.5 * r - 0.418688 * g - 0.081312 * b,
    }
}

#[inline]
fn yc_to_rgb(y: f32, cb: f32, cr: f32) -> (f32, f32, f32) {
    (
        y + 1.402 * cr,
        y - 0.344136 * cb - 0.714136 * cr,
        y + 1.772 * cb,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgb;
    use serde::Deserialize;
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Manifest {
        fixtures: Vec<Fixture>,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Fixture {
        fixture_id: String,
        kind: String,
        source_kind: String,
        generator: Option<Generator>,
        expected_metrics: ExpectedMetrics,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Generator {
        base_pattern: String,
        chroma_noise_sigma: f32,
        height: u32,
        luma_noise_sigma: f32,
        seed: String,
        width: u32,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ExpectedMetrics {
        chroma_sigma_after: MetricRange,
        delta_e_max: MetricRange,
        edge_preservation_ratio: MetricRange,
        luma_sigma_after: MetricRange,
        texture_energy_ratio: MetricRange,
    }

    #[derive(Debug, Deserialize)]
    struct MetricRange {
        min: f32,
        max: f32,
    }

    #[derive(Debug)]
    struct Metrics {
        chroma_sigma_after: f32,
        delta_e_max: f32,
        edge_preservation_ratio: f32,
        luma_sigma_after: f32,
        texture_energy_ratio: f32,
    }

    #[test]
    fn denoise_cpu_reference_matches_synthetic_fixture_contract() {
        let manifest_path = repo_root().join("fixtures/detail/denoise/denoise-fixtures.json");
        let manifest: Manifest =
            serde_json::from_str(&fs::read_to_string(manifest_path).unwrap()).unwrap();
        let settings = DenoiseCpuReferenceSettings::from_intensity(0.62);
        let mut reports = Vec::new();

        for fixture in manifest
            .fixtures
            .iter()
            .filter(|fixture| fixture.source_kind == "synthetic_public")
        {
            let generator = fixture.generator.as_ref().unwrap();
            let clean = synthesize_clean(generator);
            let noisy = add_deterministic_noise(&clean, generator);
            let denoised = apply_cpu_reference_denoise(&noisy, settings);
            let metrics = calculate_metrics(&clean, &noisy, &denoised);

            assert_metric(
                &fixture.fixture_id,
                "lumaSigmaAfter",
                metrics.luma_sigma_after,
                &fixture.expected_metrics.luma_sigma_after,
            );
            assert_metric(
                &fixture.fixture_id,
                "chromaSigmaAfter",
                metrics.chroma_sigma_after,
                &fixture.expected_metrics.chroma_sigma_after,
            );
            assert_metric(
                &fixture.fixture_id,
                "edgePreservationRatio",
                metrics.edge_preservation_ratio,
                &fixture.expected_metrics.edge_preservation_ratio,
            );
            assert_metric(
                &fixture.fixture_id,
                "textureEnergyRatio",
                metrics.texture_energy_ratio,
                &fixture.expected_metrics.texture_energy_ratio,
            );
            assert_metric(
                &fixture.fixture_id,
                "deltaEMax",
                metrics.delta_e_max,
                &fixture.expected_metrics.delta_e_max,
            );

            reports.push(json!({
                "fixtureId": fixture.fixture_id,
                "kind": fixture.kind,
                "runtimeStatus": "cpu_reference_only",
                "artifacts": {
                    "cleanReference": format!("generated://{}", fixture.fixture_id),
                    "noisyInput": format!("generated://{}#noisy", fixture.fixture_id),
                    "denoisedOutput": format!("generated://{}#denoised", fixture.fixture_id)
                },
                "metrics": {
                    "lumaSigmaAfter": metrics.luma_sigma_after,
                    "chromaSigmaAfter": metrics.chroma_sigma_after,
                    "edgePreservationRatio": metrics.edge_preservation_ratio,
                    "textureEnergyRatio": metrics.texture_energy_ratio,
                    "deltaEMax": metrics.delta_e_max
                },
                "doesNotProve": [
                    "preview_export_parity",
                    "real_raw_quality",
                    "gpu_parity",
                    "ui_api_e2e"
                ]
            }));
        }

        let report_path = report_path();
        if let Some(parent) = report_path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(
            report_path,
            serde_json::to_vec_pretty(&json!({
                "schemaVersion": 1,
                "issue": 1172,
                "runtimeStatus": "cpu_reference_only",
                "stage": "scene_linear_post_demosaic",
                "fixtures": reports
            }))
            .unwrap(),
        )
        .unwrap();
    }

    fn assert_metric(fixture_id: &str, metric: &str, value: f32, expected: &MetricRange) {
        assert!(
            value >= expected.min && value <= expected.max,
            "{} {}={} outside [{}, {}]",
            fixture_id,
            metric,
            value,
            expected.min,
            expected.max
        );
    }

    fn repo_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri has a repo parent")
            .to_path_buf()
    }

    fn report_path() -> PathBuf {
        std::env::var("RAWENGINE_DENOISE_CPU_REPORT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                repo_root().join("src-tauri/target/rawengine-denoise-cpu-reference-report.json")
            })
    }

    fn synthesize_clean(generator: &Generator) -> Rgb32FImage {
        let mut image = Rgb32FImage::new(generator.width, generator.height);
        let width = generator.width.max(1) as f32;
        let height = generator.height.max(1) as f32;
        for y in 0..generator.height {
            for x in 0..generator.width {
                let fx = x as f32 / width;
                let fy = y as f32 / height;
                let pixel = match generator.base_pattern.as_str() {
                    "chroma_edge" => {
                        if fx < 0.5 {
                            Rgb([0.42, 0.30 + fy * 0.05, 0.28])
                        } else {
                            Rgb([0.27, 0.31 + fy * 0.05, 0.45])
                        }
                    }
                    "fine_texture_patch" => {
                        let wave = ((x as f32 * 0.62).sin() * (y as f32 * 0.41).cos()) * 0.035;
                        let checker = if ((x / 4) + (y / 4)) % 2 == 0 {
                            0.018
                        } else {
                            -0.018
                        };
                        let v = (0.42 + wave + checker).clamp(0.0, 1.0);
                        Rgb([v, v * 0.99, v * 1.01])
                    }
                    _ => {
                        let v = 0.12 + fx * 0.18 + fy * 0.04;
                        Rgb([v, v * 1.01, v * 0.99])
                    }
                };
                image.put_pixel(x, y, pixel);
            }
        }
        image
    }

    fn add_deterministic_noise(clean: &Rgb32FImage, generator: &Generator) -> Rgb32FImage {
        let mut state = hash_seed(&generator.seed);
        let mut noisy = clean.clone();
        for pixel in noisy.pixels_mut() {
            let luma_noise = next_centered(&mut state) * generator.luma_noise_sigma;
            let chroma_a = next_centered(&mut state) * generator.chroma_noise_sigma;
            let chroma_b = next_centered(&mut state) * generator.chroma_noise_sigma;
            pixel[0] = (pixel[0] + luma_noise + chroma_a * 0.7).clamp(0.0, 1.0);
            pixel[1] = (pixel[1] + luma_noise - chroma_a * 0.25 + chroma_b * 0.35).clamp(0.0, 1.0);
            pixel[2] = (pixel[2] + luma_noise - chroma_b * 0.7).clamp(0.0, 1.0);
        }
        noisy
    }

    fn calculate_metrics(
        clean: &Rgb32FImage,
        noisy: &Rgb32FImage,
        denoised: &Rgb32FImage,
    ) -> Metrics {
        let mut luma_sq_sum = 0.0;
        let mut chroma_sq_sum = 0.0;
        let mut delta_e_max: f32 = 0.0;
        let pixel_count = (clean.width() * clean.height()).max(1) as f32;

        for ((clean_pixel, noisy_pixel), denoised_pixel) in
            clean.pixels().zip(noisy.pixels()).zip(denoised.pixels())
        {
            let clean_yc = rgb_to_yc(clean_pixel[0], clean_pixel[1], clean_pixel[2]);
            let noisy_yc = rgb_to_yc(noisy_pixel[0], noisy_pixel[1], noisy_pixel[2]);
            let denoised_yc = rgb_to_yc(denoised_pixel[0], denoised_pixel[1], denoised_pixel[2]);
            let luma_residual = denoised_yc.y - clean_yc.y;
            let chroma_residual_cb = denoised_yc.cb - clean_yc.cb;
            let chroma_residual_cr = denoised_yc.cr - clean_yc.cr;
            luma_sq_sum += luma_residual * luma_residual;
            chroma_sq_sum +=
                chroma_residual_cb * chroma_residual_cb + chroma_residual_cr * chroma_residual_cr;
            let noisy_delta = (noisy_yc.y - clean_yc.y).abs();
            let denoised_delta = (denoised_yc.y - clean_yc.y).abs();
            delta_e_max = delta_e_max.max((denoised_delta - noisy_delta).max(0.0) * 12.0);
        }

        Metrics {
            luma_sigma_after: (luma_sq_sum / pixel_count).sqrt(),
            chroma_sigma_after: (chroma_sq_sum / (pixel_count * 2.0)).sqrt(),
            edge_preservation_ratio: edge_preservation_ratio(clean, denoised),
            texture_energy_ratio: texture_energy_ratio(clean, denoised),
            delta_e_max,
        }
    }

    fn edge_preservation_ratio(clean: &Rgb32FImage, denoised: &Rgb32FImage) -> f32 {
        let width = clean.width();
        let height = clean.height();
        let mut clean_energy = 0.0;
        let mut denoised_energy = 0.0;
        for y in 0..height {
            for x in 1..width {
                let clean_prev = clean.get_pixel(x - 1, y);
                let clean_curr = clean.get_pixel(x, y);
                let clean_delta = (rgb_to_yc(clean_curr[0], clean_curr[1], clean_curr[2]).y
                    - rgb_to_yc(clean_prev[0], clean_prev[1], clean_prev[2]).y)
                    .abs();
                if clean_delta < 0.08 {
                    continue;
                }
                let denoised_prev = denoised.get_pixel(x - 1, y);
                let denoised_curr = denoised.get_pixel(x, y);
                let denoised_delta =
                    (rgb_to_yc(denoised_curr[0], denoised_curr[1], denoised_curr[2]).y
                        - rgb_to_yc(denoised_prev[0], denoised_prev[1], denoised_prev[2]).y)
                        .abs();
                clean_energy += clean_delta;
                denoised_energy += denoised_delta;
            }
        }
        if clean_energy <= 1e-6 {
            return 1.0;
        }
        denoised_energy / clean_energy
    }

    fn texture_energy_ratio(clean: &Rgb32FImage, denoised: &Rgb32FImage) -> f32 {
        let width = clean.width();
        let height = clean.height();
        if width < 3 || height < 3 {
            return 1.0;
        }
        let mut correlated_energy = 0.0;
        let mut clean_energy = 0.0;
        for y in 1..height - 1 {
            for x in 1..width - 1 {
                let clean_hf = high_frequency_at(clean, x, y);
                let denoised_hf = high_frequency_at(denoised, x, y);
                correlated_energy += clean_hf * denoised_hf;
                clean_energy += clean_hf * clean_hf;
            }
        }
        if clean_energy < 1e-6 {
            return 1.0;
        }
        (correlated_energy / clean_energy).clamp(0.0, 2.0)
    }

    fn high_frequency_at(image: &Rgb32FImage, x: u32, y: u32) -> f32 {
        let center = luma_at(image, x, y);
        let neighbor_mean = (luma_at(image, x - 1, y)
            + luma_at(image, x + 1, y)
            + luma_at(image, x, y - 1)
            + luma_at(image, x, y + 1))
            * 0.25;
        center - neighbor_mean
    }

    fn luma_at(image: &Rgb32FImage, x: u32, y: u32) -> f32 {
        let pixel = image.get_pixel(x, y);
        rgb_to_yc(pixel[0], pixel[1], pixel[2]).y
    }

    fn hash_seed(seed: &str) -> u64 {
        seed.bytes().fold(0xcbf29ce484222325_u64, |hash, byte| {
            (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3)
        })
    }

    fn next_centered(state: &mut u64) -> f32 {
        *state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        let value = ((*state >> 32) as u32) as f32 / u32::MAX as f32;
        (value - 0.5) * 2.0
    }

    #[test]
    fn denoise_cpu_reference_preserves_zero_strength() {
        let mut image = Rgb32FImage::new(2, 1);
        image.put_pixel(0, 0, Rgb([0.1, 0.2, 0.3]));
        image.put_pixel(1, 0, Rgb([0.4, 0.5, 0.6]));
        let output =
            apply_cpu_reference_denoise(&image, DenoiseCpuReferenceSettings::from_intensity(0.0));
        assert_eq!(image.as_raw(), output.as_raw());
    }

    #[test]
    fn noise_profile_is_deterministic_and_measures_noisier_shadows() {
        let image = Rgb32FImage::from_fn(24, 12, |x, y| {
            let shadow = x < 12;
            let base = if shadow { 0.12 } else { 0.78 };
            let amplitude = if shadow { 0.025 } else { 0.004 };
            let noise = (((x * 7 + y * 11) % 9) as f32 - 4.0) * amplitude;
            Rgb([base + noise, base - noise * 0.4, base + noise * 0.25])
        });

        let first = analyze_noise_profile(&image, DenoiseSourceClass::BayerRaw);
        let second = analyze_noise_profile(&image, DenoiseSourceClass::BayerRaw);

        assert_eq!(first, second);
        assert_eq!(first.implementation_version, 2);
        assert!(first.confidence > 0.0);
        assert!(
            first.measured_noise_by_exposure_band.shadows
                > first.measured_noise_by_exposure_band.highlights
        );
    }

    #[test]
    fn scene_linear_negative_and_over_range_values_are_not_clamped() {
        let image = Rgb32FImage::from_pixel(5, 5, Rgb([1.25, -0.2, 0.55]));
        let output =
            apply_cpu_reference_denoise(&image, DenoiseCpuReferenceSettings::from_intensity(0.8));
        let pixel = output.get_pixel(2, 2);

        assert!(pixel[0] > 1.0);
        assert!(pixel[1] < 0.0);
        assert!(pixel.0.iter().all(|channel| channel.is_finite()));
    }

    #[test]
    fn natural_grain_restores_luma_residual_without_restoring_chroma_strength() {
        let image = Rgb32FImage::from_fn(16, 16, |x, y| {
            let base = 0.35 + x as f32 * 0.008;
            let luma_noise = (((x * 13 + y * 5) % 7) as f32 - 3.0) * 0.012;
            let chroma_noise = (((x * 3 + y * 17) % 11) as f32 - 5.0) * 0.008;
            Rgb([
                base + luma_noise + chroma_noise,
                base + luma_noise,
                base + luma_noise - chroma_noise,
            ])
        });
        let smooth = DenoiseCpuReferenceSettings {
            luma_strength: 0.8,
            chroma_strength: 0.8,
            edge_threshold: 0.03,
            contrast_protection: 0.5,
            detail: 0.5,
            natural_grain: 0.0,
            shadow_bias: 0.0,
        };
        let restored = DenoiseCpuReferenceSettings {
            natural_grain: 0.8,
            ..smooth
        };
        let profile = analyze_noise_profile(&image, DenoiseSourceClass::EncodedRgb);
        let smooth_output = apply_cpu_reference_denoise_with_profile(&image, smooth, &profile);
        let restored_output = apply_cpu_reference_denoise_with_profile(&image, restored, &profile);
        let smooth_luma_delta = image
            .pixels()
            .zip(smooth_output.pixels())
            .map(|(source, output)| {
                (rgb_to_yc(source[0], source[1], source[2]).y
                    - rgb_to_yc(output[0], output[1], output[2]).y)
                    .abs()
            })
            .sum::<f32>();
        let restored_luma_delta = image
            .pixels()
            .zip(restored_output.pixels())
            .map(|(source, output)| {
                (rgb_to_yc(source[0], source[1], source[2]).y
                    - rgb_to_yc(output[0], output[1], output[2]).y)
                    .abs()
            })
            .sum::<f32>();
        let output_chroma_delta = smooth_output
            .pixels()
            .zip(restored_output.pixels())
            .map(|(smooth_pixel, restored_pixel)| {
                let smooth_yc = rgb_to_yc(smooth_pixel[0], smooth_pixel[1], smooth_pixel[2]);
                let restored_yc =
                    rgb_to_yc(restored_pixel[0], restored_pixel[1], restored_pixel[2]);
                (smooth_yc.cb - restored_yc.cb).abs() + (smooth_yc.cr - restored_yc.cr).abs()
            })
            .sum::<f32>();

        assert!(restored_luma_delta < smooth_luma_delta * 0.5);
        assert!(output_chroma_delta < 1e-4);
    }
}
