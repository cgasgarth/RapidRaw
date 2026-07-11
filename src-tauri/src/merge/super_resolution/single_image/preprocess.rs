use image::{Rgb, Rgb32FImage, imageops};

const HIGHLIGHT_GUARD_START: f32 = 0.9;
const HIGHLIGHT_GUARD_END: f32 = 1.0;

pub fn scene_linear_to_encoded_srgb(input: &Rgb32FImage) -> Rgb32FImage {
    map_channels(input, |value| {
        let value = value.clamp(0.0, 1.0);
        if value <= 0.003_130_8 {
            12.92 * value
        } else {
            1.055 * value.powf(1.0 / 2.4) - 0.055
        }
    })
}

pub fn encoded_srgb_to_scene_linear(input: &Rgb32FImage) -> Rgb32FImage {
    map_channels(input, |value| {
        let value = value.clamp(0.0, 1.0);
        if value <= 0.040_45 {
            value / 12.92
        } else {
            ((value + 0.055) / 1.055).powf(2.4)
        }
    })
}

pub fn bicubic_scene_linear_x2(input: &Rgb32FImage) -> Rgb32FImage {
    imageops::resize(
        input,
        input.width().checked_mul(2).expect("validated image width"),
        input
            .height()
            .checked_mul(2)
            .expect("validated image height"),
        imageops::FilterType::CatmullRom,
    )
}

pub fn apply_highlight_safe_residual(
    source_scene_linear: &Rgb32FImage,
    baseline_scene_linear: &Rgb32FImage,
    ai_encoded: &Rgb32FImage,
) -> Rgb32FImage {
    let ai_linear = encoded_srgb_to_scene_linear(ai_encoded);
    let mut output = baseline_scene_linear.clone();
    for (x, y, pixel) in output.enumerate_pixels_mut() {
        let baseline = baseline_scene_linear.get_pixel(x, y);
        let ai = ai_linear.get_pixel(x, y);
        let guard = source_scene_linear.get_pixel(x / 2, y / 2);
        for channel in 0..3 {
            let value = guard[channel];
            let weight = if !(0.0..=1.0).contains(&value) {
                0.0
            } else if value <= HIGHLIGHT_GUARD_START {
                1.0
            } else {
                let t = ((value - HIGHLIGHT_GUARD_START)
                    / (HIGHLIGHT_GUARD_END - HIGHLIGHT_GUARD_START))
                    .clamp(0.0, 1.0);
                0.5 + 0.5 * (std::f32::consts::PI * t).cos()
            };
            pixel[channel] = baseline[channel] + weight * (ai[channel] - baseline[channel]);
        }
    }
    output
}

fn map_channels(input: &Rgb32FImage, transform: impl Fn(f32) -> f32) -> Rgb32FImage {
    Rgb32FImage::from_fn(input.width(), input.height(), |x, y| {
        let pixel = input.get_pixel(x, y);
        Rgb([
            transform(pixel[0]),
            transform(pixel[1]),
            transform(pixel[2]),
        ])
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extended_highlights_are_exactly_bicubic() {
        let source = Rgb32FImage::from_pixel(3, 3, Rgb([1.2, -0.1, 0.5]));
        let baseline = bicubic_scene_linear_x2(&source);
        let ai = Rgb32FImage::from_pixel(6, 6, Rgb([0.0, 1.0, 1.0]));
        let output = apply_highlight_safe_residual(&source, &baseline, &ai);
        assert_eq!(output.get_pixel(2, 2)[0], baseline.get_pixel(2, 2)[0]);
        assert_eq!(output.get_pixel(2, 2)[1], baseline.get_pixel(2, 2)[1]);
        assert_ne!(output.get_pixel(2, 2)[2], baseline.get_pixel(2, 2)[2]);
    }

    #[test]
    fn srgb_transfer_round_trip_is_bounded() {
        let input = Rgb32FImage::from_fn(17, 9, |x, y| {
            let value = (x + y) as f32 / 24.0;
            Rgb([value, value * 0.5, value * value])
        });
        let round_trip = encoded_srgb_to_scene_linear(&scene_linear_to_encoded_srgb(&input));
        let max_error = input
            .pixels()
            .zip(round_trip.pixels())
            .flat_map(|(a, b)| (0..3).map(move |channel| (a[channel] - b[channel]).abs()))
            .fold(0.0_f32, f32::max);
        assert!(max_error < 1e-5, "max error {max_error}");
    }
}
