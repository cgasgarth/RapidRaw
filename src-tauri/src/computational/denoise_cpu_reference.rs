use image::Rgb32FImage;
use rayon::prelude::*;

#[derive(Debug, Clone, Copy)]
pub struct DenoiseCpuReferenceSettings {
    pub luma_strength: f32,
    pub chroma_strength: f32,
    pub edge_threshold: f32,
}

impl DenoiseCpuReferenceSettings {
    pub fn from_intensity(intensity: f32) -> Self {
        let strength = intensity.clamp(0.0, 1.0);
        Self {
            luma_strength: strength * 0.32,
            chroma_strength: strength * 0.52,
            edge_threshold: 0.018 + (1.0 - strength) * 0.045,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct YcPixel {
    y: f32,
    cb: f32,
    cr: f32,
}

pub fn apply_cpu_reference_denoise(
    image: &Rgb32FImage,
    settings: DenoiseCpuReferenceSettings,
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
            let filtered = edge_aware_average(&source, width, height, x, y, settings);
            let edge_guard =
                local_edge_guard(&source, width, height, x, y, settings.edge_threshold);
            let luma_mix = settings.luma_strength * (1.0 - 0.85 * edge_guard);
            let chroma_mix = settings.chroma_strength * (1.0 - 0.55 * edge_guard);
            let out_y = lerp(center.y, filtered.y, luma_mix);
            let out_cb = lerp(center.cb, filtered.cb, chroma_mix);
            let out_cr = lerp(center.cr, filtered.cr, chroma_mix);
            let (r, g, b) = yc_to_rgb(out_y, out_cb, out_cr);
            out[0] = r.clamp(0.0, 1.0);
            out[1] = g.clamp(0.0, 1.0);
            out[2] = b.clamp(0.0, 1.0);
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
) -> YcPixel {
    let center = source[y * width + x];
    let radius = 2_i32;
    let sigma_y = settings.edge_threshold.max(0.006);
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
}
