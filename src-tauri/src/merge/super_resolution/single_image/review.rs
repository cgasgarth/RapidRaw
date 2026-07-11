use std::path::Path;

use image::Rgb32FImage;
use serde::Serialize;
use sha2::{Digest, Sha256};

use super::model::{MODEL_ID, MODEL_SHA256};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SingleImageX2Review {
    pub decision: &'static str,
    pub manual_review_required: bool,
    pub input_hash: String,
    pub output_hash: String,
    pub bicubic_hash: String,
    pub model_id: &'static str,
    pub model_sha256: &'static str,
    pub downsample_mae: f64,
    pub mean_absolute_residual: f64,
    pub max_absolute_residual: f64,
    pub nonfinite_count: u64,
    pub tile_policy_id: &'static str,
    pub color_policy_id: &'static str,
}

pub fn build_review(
    input: &Rgb32FImage,
    bicubic: &Rgb32FImage,
    output: &Rgb32FImage,
    _ai_encoded: &Rgb32FImage,
    _model_path: &Path,
) -> Result<SingleImageX2Review, String> {
    let downsample = image::imageops::resize(
        output,
        input.width(),
        input.height(),
        image::imageops::FilterType::CatmullRom,
    );
    let downsample_mae = mae(input, &downsample);
    let (mean_absolute_residual, max_absolute_residual) = residual(bicubic, output);
    let nonfinite_count = output
        .pixels()
        .flat_map(|pixel| pixel.0)
        .filter(|value| !value.is_finite())
        .count() as u64;
    let pass = output.dimensions() == (input.width() * 2, input.height() * 2)
        && downsample_mae <= 0.015
        && nonfinite_count == 0;
    Ok(SingleImageX2Review {
        decision: if pass {
            "preview_only_manual_review"
        } else {
            "preview_only_blocked"
        },
        manual_review_required: true,
        input_hash: hash_image(input),
        output_hash: hash_image(output),
        bicubic_hash: hash_image(bicubic),
        model_id: MODEL_ID,
        model_sha256: MODEL_SHA256,
        downsample_mae,
        mean_absolute_residual,
        max_absolute_residual,
        nonfinite_count,
        tile_policy_id: "swinir-x2-lr256-overlap64-raised-cosine-row-major-v1",
        color_policy_id: "scene-linear-srgb_to_encoded-srgb_residual-highlight-taper-0.9-1.0-v1",
    })
}

fn mae(a: &Rgb32FImage, b: &Rgb32FImage) -> f64 {
    let sum: f64 = a
        .pixels()
        .zip(b.pixels())
        .flat_map(|(a, b)| (0..3).map(move |channel| f64::from((a[channel] - b[channel]).abs())))
        .sum();
    sum / (u64::from(a.width()) * u64::from(a.height()) * 3) as f64
}

fn residual(a: &Rgb32FImage, b: &Rgb32FImage) -> (f64, f64) {
    let mut sum = 0.0;
    let mut max = 0.0_f64;
    let mut count = 0_u64;
    for value in a
        .pixels()
        .zip(b.pixels())
        .flat_map(|(a, b)| (0..3).map(move |channel| f64::from((a[channel] - b[channel]).abs())))
    {
        sum += value;
        max = max.max(value);
        count += 1;
    }
    (sum / count.max(1) as f64, max)
}

fn hash_image(image: &Rgb32FImage) -> String {
    let mut hasher = Sha256::new();
    hasher.update(image.width().to_le_bytes());
    hasher.update(image.height().to_le_bytes());
    for value in image.as_raw() {
        hasher.update(value.to_le_bytes());
    }
    format!("sha256:{}", hex::encode(hasher.finalize()))
}
