use image::Rgb32FImage;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const DEFAULT_WORKING_SPACE: &str = "linear_srgb_d65";
const DEFAULT_TRANSFORM_ID: &str = "linear_srgb_d65_cielab_v1";
const ALGORITHM_ID: &str = "negative_lab_scanner_color_finish_v1";
const CHROMA_REFERENCE: f32 = 80.0;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct NegativeLabScannerColorFinishParams {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub chroma_denoise_radius: f32,
    #[serde(default)]
    pub chroma_denoise_strength: f32,
    #[serde(default)]
    pub vibrance: f32,
    #[serde(default)]
    pub saturation_trim: f32,
    #[serde(default = "default_algorithm_version")]
    pub algorithm_version: u8,
}

fn default_algorithm_version() -> u8 {
    1
}

impl Default for NegativeLabScannerColorFinishParams {
    fn default() -> Self {
        Self {
            enabled: false,
            chroma_denoise_radius: 0.0,
            chroma_denoise_strength: 0.0,
            vibrance: 0.0,
            saturation_trim: 0.0,
            algorithm_version: default_algorithm_version(),
        }
    }
}

impl NegativeLabScannerColorFinishParams {
    pub fn sanitized(&self) -> Self {
        let defaults = Self::default();
        Self {
            enabled: self.enabled,
            chroma_denoise_radius: finite_or_default(self.chroma_denoise_radius, 0.0)
                .clamp(0.0, 0.1),
            chroma_denoise_strength: finite_or_default(self.chroma_denoise_strength, 0.0)
                .clamp(0.0, 1.0),
            vibrance: finite_or_default(self.vibrance, 0.0).clamp(-0.25, 0.25),
            saturation_trim: finite_or_default(self.saturation_trim, 0.0).clamp(0.0, 0.25),
            algorithm_version: if self.algorithm_version == 0 {
                defaults.algorithm_version
            } else {
                self.algorithm_version
            },
        }
    }
}

fn finite_or_default(value: f32, fallback: f32) -> f32 {
    if value.is_finite() { value } else { fallback }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabColorFinishMetrics {
    pub operation_id: String,
    pub algorithm_id: String,
    pub algorithm_version: u8,
    pub working_space: String,
    pub transform_id: String,
    pub effective_radius_pixels: u32,
    pub changed_pixel_ratio: f32,
    pub luminance_preservation_error: f32,
    pub gamut_clipped_pixel_count: u32,
    pub warning_codes: Vec<String>,
    pub before_hash: String,
    pub after_hash: String,
}

pub struct NegativeLabColorFinishResult {
    pub image: Rgb32FImage,
    pub metrics: NegativeLabColorFinishMetrics,
}

#[derive(Clone, Copy)]
struct Lab {
    l: f32,
    a: f32,
    b: f32,
}

pub fn apply_color_finish(
    input: &Rgb32FImage,
    requested: &NegativeLabScannerColorFinishParams,
    applicable: bool,
) -> NegativeLabColorFinishResult {
    let params = requested.sanitized();
    let effective_radius_pixels =
        if params.enabled && applicable && params.chroma_denoise_radius > 0.0 {
            ((params.chroma_denoise_radius * input.width().max(input.height()) as f32).round()
                as u32)
                .clamp(1, 64)
        } else {
            0
        };
    let before_hash = hash_pixels(input);
    let mut output = input.clone();
    let mut changed_pixels = 0u32;
    let mut gamut_clipped_pixels = 0u32;
    let mut luminance_error = 0.0f32;
    let pixel_count = input.width().saturating_mul(input.height()).max(1);
    let active = params.enabled && applicable;
    let source_labs: Vec<Lab> = input.pixels().map(|pixel| rgb_to_lab(pixel.0)).collect();

    if active {
        for y in 0..input.height() {
            for x in 0..input.width() {
                let index = (y * input.width() + x) as usize;
                let original = source_labs[index];
                let mut a = original.a;
                let mut b = original.b;
                if effective_radius_pixels > 0 {
                    let radius = effective_radius_pixels as i32;
                    let mut sum_a = 0.0;
                    let mut sum_b = 0.0;
                    let mut count = 0.0;
                    for offset_y in -radius..=radius {
                        for offset_x in -radius..=radius {
                            let sample_x = x as i32 + offset_x;
                            let sample_y = y as i32 + offset_y;
                            if sample_x < 0
                                || sample_y < 0
                                || sample_x >= input.width() as i32
                                || sample_y >= input.height() as i32
                            {
                                continue;
                            }
                            let sample = source_labs
                                [(sample_y as u32 * input.width() + sample_x as u32) as usize];
                            sum_a += sample.a;
                            sum_b += sample.b;
                            count += 1.0;
                        }
                    }
                    if count > 0.0 {
                        let strength = params.chroma_denoise_strength;
                        a += (sum_a / count - a) * strength;
                        b += (sum_b / count - b) * strength;
                    }
                }
                let chroma = (a * a + b * b).sqrt();
                if params.vibrance != 0.0 {
                    let muted_weight = (1.0 - chroma / CHROMA_REFERENCE).clamp(0.0, 1.0);
                    let factor = 1.0 + params.vibrance * muted_weight;
                    a *= factor;
                    b *= factor;
                }
                if params.saturation_trim > 0.0 {
                    let saturation_weight = (chroma / CHROMA_REFERENCE).clamp(0.0, 1.0);
                    let factor = 1.0 - params.saturation_trim * saturation_weight;
                    a *= factor;
                    b *= factor;
                }
                let rgb = lab_to_rgb(Lab {
                    l: original.l,
                    a,
                    b,
                });
                let mut clipped = false;
                let clamped = rgb.map(|value| {
                    if !(0.0..=1.0).contains(&value) {
                        clipped = true;
                    }
                    value.clamp(0.0, 1.0)
                });
                if clipped {
                    gamut_clipped_pixels += 1;
                }
                let output_lab = rgb_to_lab(clamped);
                luminance_error += (output_lab.l - original.l).abs();
                let output_pixel = output.get_pixel_mut(x, y);
                if output_pixel
                    .0
                    .iter()
                    .zip(clamped)
                    .any(|(left, right)| (*left - right).abs() > 1.0e-6)
                {
                    changed_pixels += 1;
                }
                output_pixel.0 = clamped;
            }
        }
    }

    let mut warning_codes = Vec::new();
    if gamut_clipped_pixels > 0 {
        warning_codes.push("gamut_clipping_before_output_policy".to_string());
    }
    if !applicable && params.enabled {
        warning_codes.push("inapplicable_mode_identity".to_string());
    }
    let changed_pixel_ratio = if active {
        changed_pixels as f32 / pixel_count as f32
    } else {
        0.0
    };
    let luminance_preservation_error = if active {
        luminance_error / pixel_count as f32
    } else {
        0.0
    };
    let after_hash = hash_pixels(&output);
    NegativeLabColorFinishResult {
        image: output,
        metrics: NegativeLabColorFinishMetrics {
            operation_id: "negative_lab.scanner_color_finish".to_string(),
            algorithm_id: ALGORITHM_ID.to_string(),
            algorithm_version: params.algorithm_version,
            working_space: DEFAULT_WORKING_SPACE.to_string(),
            transform_id: DEFAULT_TRANSFORM_ID.to_string(),
            effective_radius_pixels,
            changed_pixel_ratio,
            luminance_preservation_error,
            gamut_clipped_pixel_count: gamut_clipped_pixels,
            warning_codes,
            before_hash,
            after_hash,
        },
    }
}

fn hash_pixels(image: &Rgb32FImage) -> String {
    let mut hasher = Sha256::new();
    for value in image.as_raw() {
        hasher.update(value.to_le_bytes());
    }
    format!("sha256:{}", hex::encode(hasher.finalize()))
}

#[allow(clippy::excessive_precision)]
fn rgb_to_lab(rgb: [f32; 3]) -> Lab {
    let xyz = [
        0.4124564 * rgb[0] + 0.3575761 * rgb[1] + 0.1804375 * rgb[2],
        0.2126729 * rgb[0] + 0.7151522 * rgb[1] + 0.0721750 * rgb[2],
        0.0193339 * rgb[0] + 0.1191920 * rgb[1] + 0.9503041 * rgb[2],
    ];
    let f = |value: f32| {
        if value > 0.008856 {
            value.cbrt()
        } else {
            7.787 * value + 16.0 / 116.0
        }
    };
    let x = f(xyz[0] / 0.95047);
    let y = f(xyz[1]);
    let z = f(xyz[2] / 1.08883);
    Lab {
        l: (116.0 * y - 16.0).clamp(0.0, 100.0),
        a: 500.0 * (x - y),
        b: 200.0 * (y - z),
    }
}

#[allow(clippy::excessive_precision)]
fn lab_to_rgb(lab: Lab) -> [f32; 3] {
    let fy = (lab.l + 16.0) / 116.0;
    let fx = lab.a / 500.0 + fy;
    let fz = fy - lab.b / 200.0;
    let f_inv = |value: f32| {
        let cube = value * value * value;
        if cube > 0.008856 {
            cube
        } else {
            (value - 16.0 / 116.0) / 7.787
        }
    };
    let xyz = [0.95047 * f_inv(fx), f_inv(fy), 1.08883 * f_inv(fz)];
    [
        3.2404542 * xyz[0] - 1.5371385 * xyz[1] - 0.4985314 * xyz[2],
        -0.9692660 * xyz[0] + 1.8760108 * xyz[1] + 0.0415560 * xyz[2],
        0.0556434 * xyz[0] - 0.2040259 * xyz[1] + 1.0572252 * xyz[2],
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_off_is_exact_identity() {
        let input = Rgb32FImage::from_vec(2, 1, vec![0.1, 0.2, 0.3, 0.7, 0.4, 0.2]).unwrap();
        let result = apply_color_finish(
            &input,
            &NegativeLabScannerColorFinishParams::default(),
            true,
        );
        assert_eq!(result.image.as_raw(), input.as_raw());
        assert_eq!(result.metrics.changed_pixel_ratio, 0.0);
        assert_eq!(result.metrics.before_hash, result.metrics.after_hash);
    }

    #[test]
    fn denoise_preserves_luminance_and_changes_chroma_patch() {
        let input =
            Rgb32FImage::from_vec(3, 1, vec![0.4, 0.35, 0.3, 0.4, 0.15, 0.3, 0.4, 0.35, 0.3])
                .unwrap();
        let result = apply_color_finish(
            &input,
            &NegativeLabScannerColorFinishParams {
                enabled: true,
                chroma_denoise_radius: 0.5,
                chroma_denoise_strength: 1.0,
                ..Default::default()
            },
            true,
        );
        assert!(result.metrics.changed_pixel_ratio > 0.0);
        assert!(result.metrics.luminance_preservation_error < 0.02);
        assert!(result.image.as_raw().iter().all(|value| value.is_finite()));
    }

    #[test]
    fn inapplicable_mode_is_identity_with_warning() {
        let input = Rgb32FImage::from_vec(1, 1, vec![0.2, 0.3, 0.4]).unwrap();
        let result = apply_color_finish(
            &input,
            &NegativeLabScannerColorFinishParams {
                enabled: true,
                vibrance: 0.2,
                ..Default::default()
            },
            false,
        );
        assert_eq!(result.image.as_raw(), input.as_raw());
        assert_eq!(result.metrics.before_hash, result.metrics.after_hash);
        assert!(
            result
                .metrics
                .warning_codes
                .iter()
                .any(|warning| warning == "inapplicable_mode_identity")
        );
    }
}
