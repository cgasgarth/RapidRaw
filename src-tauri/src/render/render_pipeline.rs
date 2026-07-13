use std::borrow::Cow;

use image::DynamicImage;
use serde_json::Value;

use crate::deblur_render::{apply_deblur_stage, calculate_deblur_render_hash};
use crate::denoise_render::{apply_denoise_stage, calculate_denoise_render_hash};
use crate::wavelet_render::{apply_wavelet_detail_stage, calculate_wavelet_detail_render_hash};

pub(crate) struct PreGpuDetailStageResult<'a> {
    pub image: Cow<'a, DynamicImage>,
    pub render_hash: u64,
}

pub(crate) fn apply_pre_gpu_detail_stages<'a>(
    image: &'a DynamicImage,
    base_hash: u64,
    adjustments: &Value,
) -> PreGpuDetailStageResult<'a> {
    let denoised_image = apply_denoise_stage(image, adjustments);
    let denoise_render_hash = calculate_denoise_render_hash(base_hash, adjustments);
    let deblurred_image = apply_deblur_stage(denoised_image.as_ref(), adjustments);
    let deblur_render_hash = calculate_deblur_render_hash(denoise_render_hash, adjustments);
    let wavelet_image = apply_wavelet_detail_stage(deblurred_image.image.as_ref(), adjustments);
    let render_hash = calculate_wavelet_detail_render_hash(deblur_render_hash, adjustments);

    let stage_changed = matches!(denoised_image, Cow::Owned(_))
        || matches!(deblurred_image.image, Cow::Owned(_))
        || matches!(wavelet_image, Cow::Owned(_));

    PreGpuDetailStageResult {
        image: if stage_changed {
            Cow::Owned(wavelet_image.into_owned())
        } else {
            Cow::Borrowed(image)
        },
        render_hash,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb, Rgb32FImage};
    use serde_json::json;

    fn test_image() -> DynamicImage {
        let image: Rgb32FImage = ImageBuffer::from_fn(8, 8, |x, y| {
            let value = (x + y) as f32 / 16.0;
            Rgb([value, value * 0.9, value * 0.8])
        });
        DynamicImage::ImageRgb32F(image)
    }

    #[test]
    fn disabled_detail_stages_borrow_input() {
        let image = test_image();
        let result = apply_pre_gpu_detail_stages(&image, 42, &json!({}));

        assert!(matches!(result.image, Cow::Borrowed(_)));
    }

    #[test]
    fn detail_stage_hash_includes_adjustment_controls() {
        let image = test_image();
        let disabled = apply_pre_gpu_detail_stages(&image, 42, &json!({}));
        let enabled = apply_pre_gpu_detail_stages(
            &image,
            42,
            &json!({
                "waveletDetailEnabled": true,
                "waveletDetailFine": 35.0
            }),
        );

        assert_ne!(disabled.render_hash, enabled.render_hash);
    }
}
