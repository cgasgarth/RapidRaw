use image::Rgb32FImage;
use rayon::prelude::*;

#[derive(Debug, Clone, Copy)]
pub struct DeblurCpuReferenceSettings {
    pub strength: f32,
    pub sigma_px: f32,
    pub iterations: usize,
    pub noise_floor: f32,
    pub max_luma_delta: f32,
}

impl DeblurCpuReferenceSettings {
    pub fn constrained_gaussian(strength: f32, sigma_px: f32) -> Self {
        let bounded_strength = strength.clamp(0.0, 1.0);
        Self {
            strength: bounded_strength,
            sigma_px: sigma_px.clamp(0.25, 1.35),
            iterations: 3,
            noise_floor: 0.018 + (1.0 - bounded_strength) * 0.03,
            max_luma_delta: 0.055 + bounded_strength * 0.035,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeblurSkipReason {
    Disabled,
    UnsupportedPsf,
    SigmaOutOfRange,
    NoiseTooHigh,
    SaturatedEdgeRisk,
    InvalidDimensions,
    MemoryBudgetExceeded,
    NonFiniteInput,
}

impl DeblurSkipReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::UnsupportedPsf => "unsupported_psf",
            Self::SigmaOutOfRange => "sigma_out_of_range",
            Self::NoiseTooHigh => "noise_too_high",
            Self::SaturatedEdgeRisk => "saturated_edge_risk",
            Self::InvalidDimensions => "invalid_dimensions",
            Self::MemoryBudgetExceeded => "memory_budget_exceeded",
            Self::NonFiniteInput => "non_finite_input",
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct DeblurCpuReferenceAssessment {
    pub gaussian_psf: bool,
    pub estimated_noise_sigma: f32,
    pub saturated_edge_fraction: f32,
}

impl DeblurCpuReferenceAssessment {
    pub fn synthetic_gaussian(estimated_noise_sigma: f32, saturated_edge_fraction: f32) -> Self {
        Self {
            gaussian_psf: true,
            estimated_noise_sigma,
            saturated_edge_fraction,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct YcPixel {
    y: f32,
    cb: f32,
    cr: f32,
}

pub fn apply_cpu_reference_deblur(
    image: &Rgb32FImage,
    settings: DeblurCpuReferenceSettings,
) -> Rgb32FImage {
    match apply_cpu_reference_deblur_checked(
        image,
        settings,
        DeblurCpuReferenceAssessment::synthetic_gaussian(settings.noise_floor, 0.0),
    ) {
        Ok(output) => output,
        Err(_) => image.clone(),
    }
}

pub fn apply_cpu_reference_deblur_checked(
    image: &Rgb32FImage,
    settings: DeblurCpuReferenceSettings,
    assessment: DeblurCpuReferenceAssessment,
) -> Result<Rgb32FImage, DeblurSkipReason> {
    let width = image.width() as usize;
    let height = image.height() as usize;
    validate_deblur_request(image, settings, assessment)?;

    let source: Vec<YcPixel> = image
        .pixels()
        .map(|pixel| rgb_to_yc(pixel[0], pixel[1], pixel[2]))
        .collect();
    let source_y: Vec<f32> = source.iter().map(|pixel| pixel.y).collect();
    let estimate_y = constrained_van_cittert(&source_y, width, height, settings);

    let mut output = vec![0.0_f32; width * height * 3];
    output
        .par_chunks_mut(3)
        .enumerate()
        .for_each(|(index, out)| {
            let center = source[index];
            let y = lerp(center.y, estimate_y[index], settings.strength);
            let (r, g, b) = yc_to_rgb(y, center.cb, center.cr);
            out[0] = r.clamp(0.0, 1.0);
            out[1] = g.clamp(0.0, 1.0);
            out[2] = b.clamp(0.0, 1.0);
        });

    Rgb32FImage::from_raw(image.width(), image.height(), output)
        .ok_or(DeblurSkipReason::InvalidDimensions)
}

pub fn validate_deblur_request(
    image: &Rgb32FImage,
    settings: DeblurCpuReferenceSettings,
    assessment: DeblurCpuReferenceAssessment,
) -> Result<(), DeblurSkipReason> {
    let width = image.width() as usize;
    let height = image.height() as usize;
    if width == 0 || height == 0 {
        return Err(DeblurSkipReason::InvalidDimensions);
    }
    if width.saturating_mul(height) > 80_000_000 {
        return Err(DeblurSkipReason::MemoryBudgetExceeded);
    }
    if settings.strength <= f32::EPSILON {
        return Err(DeblurSkipReason::Disabled);
    }
    if !assessment.gaussian_psf {
        return Err(DeblurSkipReason::UnsupportedPsf);
    }
    if !(0.45..=1.35).contains(&settings.sigma_px) || !settings.sigma_px.is_finite() {
        return Err(DeblurSkipReason::SigmaOutOfRange);
    }
    if assessment.estimated_noise_sigma > 0.05 {
        return Err(DeblurSkipReason::NoiseTooHigh);
    }
    if assessment.saturated_edge_fraction > 0.08 {
        return Err(DeblurSkipReason::SaturatedEdgeRisk);
    }
    if ![
        settings.strength,
        settings.sigma_px,
        settings.noise_floor,
        settings.max_luma_delta,
        assessment.estimated_noise_sigma,
        assessment.saturated_edge_fraction,
    ]
    .iter()
    .all(|value| value.is_finite())
    {
        return Err(DeblurSkipReason::NonFiniteInput);
    }
    if image
        .pixels()
        .any(|pixel| !pixel.0.iter().all(|value| value.is_finite()))
    {
        return Err(DeblurSkipReason::NonFiniteInput);
    }

    Ok(())
}

fn constrained_van_cittert(
    source: &[f32],
    width: usize,
    height: usize,
    settings: DeblurCpuReferenceSettings,
) -> Vec<f32> {
    let kernel = gaussian_kernel_1d(settings.sigma_px);
    let mut estimate = source.to_vec();
    let iterations = settings.iterations.clamp(1, 6);

    for _ in 0..iterations {
        let reblurred = gaussian_blur_luma(&estimate, width, height, &kernel);
        estimate
            .par_iter_mut()
            .enumerate()
            .for_each(|(index, out)| {
                let x = index % width;
                let y = index / width;
                let center = source[index];
                let residual = center - reblurred[index];
                let edge_gate = local_edge_gate(source, width, height, x, y, settings.noise_floor);
                let saturation_gate = saturation_guard(center);
                let correction = residual * settings.strength * edge_gate * saturation_gate;
                let bounded = (*out + correction).clamp(
                    center - settings.max_luma_delta,
                    center + settings.max_luma_delta,
                );
                *out = bounded.clamp(0.0, 1.0);
            });
    }

    estimate
}

fn gaussian_kernel_1d(sigma_px: f32) -> Vec<f32> {
    let sigma = sigma_px.clamp(0.25, 1.35);
    let radius = (sigma * 3.0).ceil().clamp(1.0, 5.0) as i32;
    let mut kernel = Vec::with_capacity((radius * 2 + 1) as usize);
    let mut sum = 0.0;

    for offset in -radius..=radius {
        let x = offset as f32;
        let weight = (-(x * x) / (2.0 * sigma * sigma)).exp();
        kernel.push(weight);
        sum += weight;
    }

    if sum > f32::EPSILON {
        for weight in &mut kernel {
            *weight /= sum;
        }
    }

    kernel
}

fn gaussian_blur_luma(source: &[f32], width: usize, height: usize, kernel: &[f32]) -> Vec<f32> {
    let radius = kernel.len() as i32 / 2;
    let mut horizontal = vec![0.0_f32; source.len()];
    horizontal
        .par_chunks_mut(width)
        .enumerate()
        .for_each(|(y, row)| {
            for (x, out) in row.iter_mut().enumerate() {
                let mut sum = 0.0;
                for offset in -radius..=radius {
                    let sx = (x as i32 + offset).clamp(0, width as i32 - 1) as usize;
                    sum += source[y * width + sx] * kernel[(offset + radius) as usize];
                }
                *out = sum;
            }
        });

    let mut output = vec![0.0_f32; source.len()];
    output.par_iter_mut().enumerate().for_each(|(index, out)| {
        let x = index % width;
        let y = index / width;
        let mut sum = 0.0;
        for offset in -radius..=radius {
            let sy = (y as i32 + offset).clamp(0, height as i32 - 1) as usize;
            sum += horizontal[sy * width + x] * kernel[(offset + radius) as usize];
        }
        *out = sum;
    });
    output
}

fn local_edge_gate(
    source: &[f32],
    width: usize,
    height: usize,
    x: usize,
    y: usize,
    noise_floor: f32,
) -> f32 {
    let center = source[y * width + x];
    let mut max_delta: f32 = 0.0;
    if x > 0 {
        max_delta = max_delta.max((center - source[y * width + x - 1]).abs());
    }
    if x + 1 < width {
        max_delta = max_delta.max((center - source[y * width + x + 1]).abs());
    }
    if y > 0 {
        max_delta = max_delta.max((center - source[(y - 1) * width + x]).abs());
    }
    if y + 1 < height {
        max_delta = max_delta.max((center - source[(y + 1) * width + x]).abs());
    }
    (max_delta / noise_floor.max(0.001)).clamp(0.0, 1.0)
}

#[inline]
fn saturation_guard(value: f32) -> f32 {
    let low = (value / 0.04).clamp(0.0, 1.0);
    let high = ((1.0 - value) / 0.04).clamp(0.0, 1.0);
    low.min(high)
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
        acceptance_policy: AcceptancePolicy,
        fixture_id: String,
        generator: Generator,
        kind: String,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct AcceptancePolicy {
        action: String,
        rejection_reasons: Vec<String>,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Generator {
        base_pattern: String,
        blur: Blur,
        degradation: Degradation,
        height: u32,
        seed: String,
        width: u32,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Blur {
        #[serde(rename = "type")]
        kind: String,
        sigma_px: f32,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Degradation {
        motion_blur_px: f32,
        noise_sigma: f32,
        saturation_fraction: f32,
    }

    #[derive(Debug)]
    struct Metrics {
        edge_acutance_ratio: f32,
        max_abs_delta: f32,
        noise_amplification_ratio: f32,
        texture_energy_ratio: f32,
    }

    #[test]
    fn deblur_cpu_reference_improves_accepted_synthetic_fixtures() {
        let manifest_path = repo_root().join("fixtures/detail/deblur-fixtures.json");
        let manifest: Manifest =
            serde_json::from_str(&fs::read_to_string(manifest_path).unwrap()).unwrap();
        let mut reports = Vec::new();

        for fixture in manifest
            .fixtures
            .iter()
            .filter(|fixture| fixture.acceptance_policy.action == "accept")
        {
            let clean = synthesize_clean(&fixture.generator);
            let blurred = synthesize_blurred_input(&clean, &fixture.generator);
            let settings = DeblurCpuReferenceSettings::constrained_gaussian(
                0.72,
                fixture.generator.blur.sigma_px,
            );
            let deblurred = apply_cpu_reference_deblur_checked(
                &blurred,
                settings,
                assessment_for_fixture(fixture),
            )
            .unwrap();
            let metrics = calculate_metrics(&clean, &blurred, &deblurred);

            assert!(
                metrics.edge_acutance_ratio >= 1.0,
                "{} should not reduce edge acutance: {:?}",
                fixture.fixture_id,
                metrics
            );
            assert!(
                metrics.noise_amplification_ratio <= 1.2,
                "{} should keep noise amplification bounded: {:?}",
                fixture.fixture_id,
                metrics
            );
            assert!(
                metrics.max_abs_delta <= 0.1,
                "{} should keep luma delta bounded: {:?}",
                fixture.fixture_id,
                metrics
            );

            reports.push(json!({
                "fixtureId": fixture.fixture_id,
                "kind": fixture.kind,
                "runtimeStatus": "cpu_reference_only",
                "applyStatus": "applied",
                "stage": "scene_linear_post_denoise",
                "doesNotProve": [
                    "preview_export_parity",
                    "real_raw_quality",
                    "gpu_parity",
                    "ui_api_e2e"
                ],
                "metrics": {
                    "edgeAcutanceRatio": metrics.edge_acutance_ratio,
                    "noiseAmplificationRatio": metrics.noise_amplification_ratio,
                    "textureEnergyRatio": metrics.texture_energy_ratio,
                    "maxAbsDelta": metrics.max_abs_delta
                }
            }));
        }

        if let Ok(report_path) = std::env::var("RAWENGINE_DEBLUR_CPU_REPORT") {
            let report = json!({
                "issue": 1180,
                "runtimeStatus": "cpu_reference_only",
                "stage": "scene_linear_post_denoise",
                "algorithm": "constrained_van_cittert_gaussian_luma",
                "fixtures": reports,
                "skippedFixtures": rejected_fixture_reports(&manifest),
            });
            fs::write(report_path, serde_json::to_vec_pretty(&report).unwrap()).unwrap();
        }
    }

    #[test]
    fn deblur_cpu_reference_skips_rejected_synthetic_fixtures() {
        let manifest_path = repo_root().join("fixtures/detail/deblur-fixtures.json");
        let manifest: Manifest =
            serde_json::from_str(&fs::read_to_string(manifest_path).unwrap()).unwrap();

        for fixture in manifest
            .fixtures
            .iter()
            .filter(|fixture| fixture.acceptance_policy.action == "reject")
        {
            let input =
                synthesize_blurred_input(&synthesize_clean(&fixture.generator), &fixture.generator);
            let settings = DeblurCpuReferenceSettings::constrained_gaussian(
                0.72,
                fixture.generator.blur.sigma_px,
            );
            let actual = apply_cpu_reference_deblur_checked(
                &input,
                settings,
                assessment_for_fixture(fixture),
            )
            .unwrap_err();
            let expected = expected_skip_reason(fixture);
            assert_eq!(actual, expected, "{}", fixture.fixture_id);
        }
    }

    #[test]
    fn deblur_cpu_reference_preserves_zero_strength() {
        let input = Rgb32FImage::from_fn(8, 8, |x, y| {
            let value = ((x + y) as f32 / 14.0).clamp(0.0, 1.0);
            Rgb([value, value * 0.9, value * 0.8])
        });
        let output = apply_cpu_reference_deblur(
            &input,
            DeblurCpuReferenceSettings {
                strength: 0.0,
                sigma_px: 0.8,
                iterations: 3,
                noise_floor: 0.02,
                max_luma_delta: 0.08,
            },
        );
        assert_eq!(input.as_raw(), output.as_raw());
    }

    fn synthesize_clean(generator: &Generator) -> Rgb32FImage {
        let width = generator.width;
        let height = generator.height;
        Rgb32FImage::from_fn(width, height, |x, y| {
            let nx = x as f32 / (width.saturating_sub(1)).max(1) as f32;
            let ny = y as f32 / (height.saturating_sub(1)).max(1) as f32;
            let value = match generator.base_pattern.as_str() {
                "fine_texture_patch" => {
                    let wave = (nx * 37.0 + ny * 19.0 + seed_offset(&generator.seed)).sin();
                    0.48 + 0.1 * wave + 0.05 * ((nx * 11.0).sin() * (ny * 13.0).cos())
                }
                "low_contrast_text" => {
                    let stroke = ((x / 7 + y / 11) % 3) == 0;
                    if stroke { 0.54 } else { 0.46 }
                }
                _ => {
                    if nx + ny > 0.9 {
                        0.72
                    } else {
                        0.28
                    }
                }
            };
            let clamped = value.clamp(0.0, 1.0);
            Rgb([clamped, clamped, clamped])
        })
    }

    fn synthesize_blurred_input(clean: &Rgb32FImage, generator: &Generator) -> Rgb32FImage {
        let kernel = gaussian_kernel_1d(generator.blur.sigma_px);
        let clean_y: Vec<f32> = clean.pixels().map(|pixel| pixel[0]).collect();
        let blurred_y = gaussian_blur_luma(
            &clean_y,
            clean.width() as usize,
            clean.height() as usize,
            &kernel,
        );
        let mut output = clean.clone();
        for (index, pixel) in output.pixels_mut().enumerate() {
            let noise = deterministic_noise(index as u32, &generator.seed)
                * generator.degradation.noise_sigma;
            let mut value = (blurred_y[index] + noise).clamp(0.0, 1.0);
            if generator.degradation.saturation_fraction > 0.0
                && value > 1.0 - generator.degradation.saturation_fraction
            {
                value = 1.0;
            }
            if generator.degradation.motion_blur_px > 0.0 {
                value = lerp(
                    value,
                    0.5,
                    (generator.degradation.motion_blur_px / 16.0).clamp(0.0, 0.35),
                );
            }
            *pixel = Rgb([value, value, value]);
        }
        output
    }

    fn assessment_for_fixture(fixture: &Fixture) -> DeblurCpuReferenceAssessment {
        DeblurCpuReferenceAssessment {
            gaussian_psf: fixture.generator.blur.kind == "gaussian"
                && !fixture
                    .acceptance_policy
                    .rejection_reasons
                    .iter()
                    .any(|reason| reason == "motion_psf_unknown"),
            estimated_noise_sigma: fixture.generator.degradation.noise_sigma,
            saturated_edge_fraction: fixture.generator.degradation.saturation_fraction,
        }
    }

    fn expected_skip_reason(fixture: &Fixture) -> DeblurSkipReason {
        if fixture
            .acceptance_policy
            .rejection_reasons
            .iter()
            .any(|reason| reason == "motion_psf_unknown")
        {
            DeblurSkipReason::UnsupportedPsf
        } else if fixture.generator.degradation.noise_sigma > 0.05 {
            DeblurSkipReason::NoiseTooHigh
        } else if fixture.generator.degradation.saturation_fraction > 0.08 {
            DeblurSkipReason::SaturatedEdgeRisk
        } else {
            panic!("{} lacks a CPU skip reason", fixture.fixture_id);
        }
    }

    fn rejected_fixture_reports(manifest: &Manifest) -> Vec<serde_json::Value> {
        manifest
            .fixtures
            .iter()
            .filter(|fixture| fixture.acceptance_policy.action == "reject")
            .map(|fixture| {
                json!({
                    "fixtureId": fixture.fixture_id,
                    "runtimeStatus": "cpu_reference_only",
                    "applyStatus": "skipped",
                    "skipReason": expected_skip_reason(fixture).as_str(),
                    "stage": "scene_linear_post_denoise",
                    "rejectionReasons": fixture.acceptance_policy.rejection_reasons,
                })
            })
            .collect()
    }

    fn calculate_metrics(
        clean: &Rgb32FImage,
        blurred: &Rgb32FImage,
        deblurred: &Rgb32FImage,
    ) -> Metrics {
        let clean_y: Vec<f32> = clean.pixels().map(|pixel| pixel[0]).collect();
        let blurred_y: Vec<f32> = blurred.pixels().map(|pixel| pixel[0]).collect();
        let deblurred_y: Vec<f32> = deblurred
            .pixels()
            .map(|pixel| rgb_to_yc(pixel[0], pixel[1], pixel[2]).y)
            .collect();
        let width = clean.width() as usize;
        let height = clean.height() as usize;
        let clean_edge = edge_energy(&clean_y, width, height);
        let blurred_edge = edge_energy(&blurred_y, width, height).max(0.0001);
        let deblurred_edge = edge_energy(&deblurred_y, width, height);
        let blurred_noise = residual_rms(&clean_y, &blurred_y).max(0.0001);
        let deblurred_noise = residual_rms(&clean_y, &deblurred_y);
        let blurred_texture = texture_energy(&blurred_y, width, height).max(0.0001);
        let deblurred_texture = texture_energy(&deblurred_y, width, height);
        let max_abs_delta = blurred_y
            .iter()
            .zip(&deblurred_y)
            .map(|(before, after)| (after - before).abs())
            .fold(0.0_f32, f32::max);

        Metrics {
            edge_acutance_ratio: (deblurred_edge / blurred_edge)
                .min((clean_edge / blurred_edge).max(1.0)),
            max_abs_delta,
            noise_amplification_ratio: deblurred_noise / blurred_noise,
            texture_energy_ratio: deblurred_texture / blurred_texture,
        }
    }

    fn edge_energy(values: &[f32], width: usize, height: usize) -> f32 {
        let mut sum: f32 = 0.0;
        let mut count: f32 = 0.0;
        for y in 0..height {
            for x in 0..width {
                let center = values[y * width + x];
                if x + 1 < width {
                    sum += (center - values[y * width + x + 1]).abs();
                    count += 1.0;
                }
                if y + 1 < height {
                    sum += (center - values[(y + 1) * width + x]).abs();
                    count += 1.0;
                }
            }
        }
        sum / count.max(1.0)
    }

    fn texture_energy(values: &[f32], width: usize, height: usize) -> f32 {
        let blurred = gaussian_blur_luma(values, width, height, &gaussian_kernel_1d(1.2));
        values
            .iter()
            .zip(blurred.iter())
            .map(|(value, base)| (value - base).abs())
            .sum::<f32>()
            / values.len().max(1) as f32
    }

    fn residual_rms(a: &[f32], b: &[f32]) -> f32 {
        let mse = a
            .iter()
            .zip(b.iter())
            .map(|(left, right)| {
                let delta = left - right;
                delta * delta
            })
            .sum::<f32>()
            / a.len().max(1) as f32;
        mse.sqrt()
    }

    fn deterministic_noise(index: u32, seed: &str) -> f32 {
        let mut value = index
            ^ 0x9e37_79b9
            ^ seed
                .bytes()
                .fold(0_u32, |acc, byte| acc.wrapping_mul(33) ^ byte as u32);
        value ^= value << 13;
        value ^= value >> 17;
        value ^= value << 5;
        (value as f32 / u32::MAX as f32 - 0.5) * 2.0
    }

    fn seed_offset(seed: &str) -> f32 {
        let hash = seed
            .bytes()
            .fold(0_u32, |acc, byte| acc.wrapping_mul(33) ^ byte as u32);
        (hash % 1000) as f32 / 1000.0
    }

    fn repo_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri has a repo parent")
            .to_path_buf()
    }
}
