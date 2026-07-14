use image::Rgb32FImage;
use serde::Serialize;

pub const NEGATIVE_LAB_DUST_DETECTOR_VERSION: &str = "negative_lab_dust_spot_v1";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabDustSpotCandidate {
    pub area_pixels: u32,
    pub candidate_id: String,
    pub confidence: f32,
    pub detector_version: &'static str,
    pub geometry: NegativeLabDustSpotGeometry,
    pub polarity: String,
    pub rejection_reasons: Vec<String>,
    pub support_count: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabDustSpotGeometry {
    pub coordinate_space: &'static str,
    pub height: f32,
    pub width: f32,
    pub x: f32,
    pub y: f32,
}

fn luma(image: &Rgb32FImage, x: u32, y: u32) -> f32 {
    let pixel = image.get_pixel(x, y).0;
    (pixel[0] * 0.2126 + pixel[1] * 0.7152 + pixel[2] * 0.0722).clamp(0.0, 1.0)
}

fn local_mean_and_variance(image: &Rgb32FImage, x: u32, y: u32, radius: u32) -> (f32, f32) {
    let x0 = x.saturating_sub(radius);
    let y0 = y.saturating_sub(radius);
    let x1 = (x + radius).min(image.width().saturating_sub(1));
    let y1 = (y + radius).min(image.height().saturating_sub(1));
    let mut values = Vec::new();
    for sample_y in y0..=y1 {
        for sample_x in x0..=x1 {
            if sample_x == x && sample_y == y {
                continue;
            }
            values.push(luma(image, sample_x, sample_y));
        }
    }
    if values.is_empty() {
        return (luma(image, x, y), 0.0);
    }
    let mean = values.iter().sum::<f32>() / values.len() as f32;
    let variance = values
        .iter()
        .map(|value| (value - mean).powi(2))
        .sum::<f32>()
        / values.len() as f32;
    (mean, variance)
}

pub fn detect_negative_lab_dust_spots(image: &Rgb32FImage) -> Vec<NegativeLabDustSpotCandidate> {
    let width = image.width();
    let height = image.height();
    if width < 9 || height < 9 {
        return Vec::new();
    }
    let mut candidates = Vec::new();
    let border = 4;
    for y in border..height.saturating_sub(border) {
        for x in border..width.saturating_sub(border) {
            let center = luma(image, x, y);
            let (mean, variance) = local_mean_and_variance(image, x, y, 2);
            let residual = center - mean;
            let magnitude = residual.abs();
            if magnitude < 0.16 || variance > 0.018 {
                continue;
            }
            let confidence = ((magnitude - 0.16) / 0.45).clamp(0.0, 1.0);
            if candidates
                .iter()
                .any(|candidate: &NegativeLabDustSpotCandidate| {
                    let candidate_x = candidate.geometry.x * width as f32;
                    let candidate_y = candidate.geometry.y * height as f32;
                    (candidate_x - x as f32).hypot(candidate_y - y as f32) < 8.0
                })
            {
                continue;
            }
            candidates.push(NegativeLabDustSpotCandidate {
                area_pixels: 1,
                candidate_id: format!("negative_lab_dust_{}_{}", x, y),
                confidence,
                detector_version: NEGATIVE_LAB_DUST_DETECTOR_VERSION,
                geometry: NegativeLabDustSpotGeometry {
                    coordinate_space: "normalized_frame",
                    height: 6.0 / height as f32,
                    width: 6.0 / width as f32,
                    x: (x as f32 - 3.0) / width as f32,
                    y: (y as f32 - 3.0) / height as f32,
                },
                polarity: if residual >= 0.0 { "light" } else { "dark" }.to_string(),
                rejection_reasons: Vec::new(),
                support_count: magnitude.mul_add(100.0, 0.0).round() as u32,
            });
        }
    }
    candidates.sort_by(|left, right| right.confidence.total_cmp(&left.confidence));
    candidates.truncate(64);
    candidates
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb, Rgb32FImage};

    fn flat_image(width: u32, height: u32) -> Rgb32FImage {
        Rgb32FImage::from_fn(width, height, |_x, _y| Rgb([0.45, 0.45, 0.45]))
    }

    #[test]
    fn clean_field_has_no_dust_candidates() {
        assert!(detect_negative_lab_dust_spots(&flat_image(32, 32)).is_empty());
    }

    #[test]
    fn compact_bright_defect_is_localized() {
        let mut image = flat_image(32, 32);
        image.put_pixel(16, 16, Rgb([1.0, 1.0, 1.0]));
        let candidates = detect_negative_lab_dust_spots(&image);
        assert_eq!(candidates.len(), 1);
        assert!(candidates[0].geometry.x > 0.35 && candidates[0].geometry.x < 0.55);
        assert_eq!(candidates[0].polarity, "light");
    }

    #[test]
    fn textured_field_is_rejected() {
        let image = Rgb32FImage::from_fn(32, 32, |x, y| {
            let value = if (x + y) % 2 == 0 { 0.1 } else { 0.9 };
            Rgb([value, value, value])
        });
        assert!(detect_negative_lab_dust_spots(&image).is_empty());
    }
}
