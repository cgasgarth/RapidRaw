pub(crate) const SRGB_OKLAB_CHROMA_REDUCE_V1: &str = "rawengine.gamut.srgb-oklab-chroma-reduce.v1";
pub(crate) const SRGB_OKLAB_CHROMA_REDUCE_V2: &str = "rawengine.gamut.srgb-oklab-chroma-reduce.v2";
pub(crate) const ACTIVE_SRGB_OKLAB_CHROMA_REDUCE: &str = SRGB_OKLAB_CHROMA_REDUCE_V2;

const EPSILON: f32 = 1.0e-6;

pub(crate) fn map_srgb_oklab_chroma_reduce_v1(rgb: [f32; 3]) -> [f32; 3] {
    if rgb
        .iter()
        .all(|component| component.is_finite() && (0.0..=1.0).contains(component))
    {
        return rgb;
    }

    let safe_rgb = [
        finite_or_zero(rgb[0]),
        finite_or_zero(rgb[1]),
        finite_or_zero(rgb[2]),
    ];
    let oklab = linear_srgb_to_oklab(safe_rgb);
    let neutral = oklab_to_linear_srgb([oklab[0], 0.0, 0.0]);

    if !is_in_srgb_gamut(neutral) {
        return clamp_rgb(safe_rgb);
    }

    let mut low = 0.0_f32;
    let mut high = 1.0_f32;
    let mut best = neutral;

    for _ in 0..24 {
        let mid = (low + high) * 0.5;
        let candidate = oklab_to_linear_srgb([oklab[0], oklab[1] * mid, oklab[2] * mid]);

        if is_in_srgb_gamut(candidate) {
            best = candidate;
            low = mid;
        } else {
            high = mid;
        }
    }

    clamp_rgb(best)
}

pub(crate) fn map_srgb_oklab_chroma_reduce_v2(rgb: [f32; 3]) -> [f32; 3] {
    if rgb
        .iter()
        .all(|component| component.is_finite() && (0.0..=1.0).contains(component))
    {
        return rgb;
    }

    let safe_rgb = [
        finite_or_zero(rgb[0]),
        finite_or_zero(rgb[1]),
        finite_or_zero(rgb[2]),
    ];
    let oklab = linear_srgb_to_oklab(safe_rgb);
    let fitted_lightness = fit_oklab_lightness_to_srgb_neutral(oklab[0]);
    let neutral = oklab_to_linear_srgb([fitted_lightness, 0.0, 0.0]);

    if !is_in_srgb_gamut(neutral) {
        return clamp_rgb(neutral);
    }

    let mut low = 0.0_f32;
    let mut high = 1.0_f32;
    let mut best = neutral;

    for _ in 0..28 {
        let mid = (low + high) * 0.5;
        let candidate = oklab_to_linear_srgb([fitted_lightness, oklab[1] * mid, oklab[2] * mid]);

        if is_in_srgb_gamut(candidate) {
            best = candidate;
            low = mid;
        } else {
            high = mid;
        }
    }

    clamp_rgb(best)
}

pub(crate) fn map_srgb_oklab_chroma_reduce_rgb16_pixels(pixels: &[f32]) -> Vec<u16> {
    pixels
        .chunks_exact(3)
        .flat_map(|pixel| {
            let mapped = map_srgb_oklab_chroma_reduce_v2([pixel[0], pixel[1], pixel[2]]);
            mapped.map(quantize_linear_component_to_u16)
        })
        .collect()
}

fn fit_oklab_lightness_to_srgb_neutral(lightness: f32) -> f32 {
    if !lightness.is_finite() {
        return 0.0;
    }

    let clamped = lightness.clamp(0.0, 1.0);
    if is_in_srgb_gamut(oklab_to_linear_srgb([clamped, 0.0, 0.0])) {
        clamped
    } else if lightness < 0.0 {
        0.0
    } else {
        1.0
    }
}

fn finite_or_zero(value: f32) -> f32 {
    if value.is_finite() { value } else { 0.0 }
}

fn is_in_srgb_gamut(rgb: [f32; 3]) -> bool {
    rgb.iter().all(|component| {
        component.is_finite() && *component >= -EPSILON && *component <= 1.0 + EPSILON
    })
}

fn clamp_rgb(rgb: [f32; 3]) -> [f32; 3] {
    [
        rgb[0].clamp(0.0, 1.0),
        rgb[1].clamp(0.0, 1.0),
        rgb[2].clamp(0.0, 1.0),
    ]
}

fn quantize_linear_component_to_u16(value: f32) -> u16 {
    (value.clamp(0.0, 1.0) * u16::MAX as f32).round() as u16
}

fn linear_srgb_to_oklab(rgb: [f32; 3]) -> [f32; 3] {
    let l = 0.412_221_46 * rgb[0] + 0.536_332_55 * rgb[1] + 0.051_445_995 * rgb[2];
    let m = 0.211_903_5 * rgb[0] + 0.680_699_5 * rgb[1] + 0.107_396_96 * rgb[2];
    let s = 0.088_302_46 * rgb[0] + 0.281_718_85 * rgb[1] + 0.629_978_7 * rgb[2];

    let l_ = cbrt_signed(l);
    let m_ = cbrt_signed(m);
    let s_ = cbrt_signed(s);

    [
        0.210_454_26 * l_ + 0.793_617_8 * m_ - 0.004_072_047 * s_,
        1.977_998_5 * l_ - 2.428_592_2 * m_ + 0.450_593_7 * s_,
        0.025_904_037 * l_ + 0.782_771_77 * m_ - 0.808_675_77 * s_,
    ]
}

fn oklab_to_linear_srgb(oklab: [f32; 3]) -> [f32; 3] {
    let l_ = oklab[0] + 0.396_337_78 * oklab[1] + 0.215_803_76 * oklab[2];
    let m_ = oklab[0] - 0.105_561_346 * oklab[1] - 0.063_854_17 * oklab[2];
    let s_ = oklab[0] - 0.089_484_18 * oklab[1] - 1.291_485_5 * oklab[2];

    let l = l_ * l_ * l_;
    let m = m_ * m_ * m_;
    let s = s_ * s_ * s_;

    [
        4.076_741_7 * l - 3.307_711_6 * m + 0.230_969_94 * s,
        -1.268_438 * l + 2.609_757_4 * m - 0.341_319_38 * s,
        -0.004_196_086_3 * l - 0.703_418_6 * m + 1.707_614_7 * s,
    ]
}

fn cbrt_signed(value: f32) -> f32 {
    value.signum() * value.abs().cbrt()
}

#[cfg(test)]
mod tests {
    use super::{
        ACTIVE_SRGB_OKLAB_CHROMA_REDUCE, SRGB_OKLAB_CHROMA_REDUCE_V1, SRGB_OKLAB_CHROMA_REDUCE_V2,
        map_srgb_oklab_chroma_reduce_v1, map_srgb_oklab_chroma_reduce_v2,
    };

    fn assert_in_gamut(rgb: [f32; 3]) {
        for component in rgb {
            assert!(
                (0.0..=1.0).contains(&component),
                "component {component} should be in gamut"
            );
        }
    }

    #[test]
    fn mapper_has_stable_version_id() {
        assert_eq!(
            SRGB_OKLAB_CHROMA_REDUCE_V1,
            "rawengine.gamut.srgb-oklab-chroma-reduce.v1"
        );
        assert_eq!(
            SRGB_OKLAB_CHROMA_REDUCE_V2,
            "rawengine.gamut.srgb-oklab-chroma-reduce.v2"
        );
        assert_eq!(ACTIVE_SRGB_OKLAB_CHROMA_REDUCE, SRGB_OKLAB_CHROMA_REDUCE_V2);
    }

    #[test]
    fn mapper_preserves_in_gamut_values_exactly() {
        let rgb = [0.25, 0.5, 0.75];

        assert_eq!(map_srgb_oklab_chroma_reduce_v2(rgb), rgb);
    }

    #[test]
    fn mapper_reduces_high_component_without_channel_clip_shape() {
        let mapped = map_srgb_oklab_chroma_reduce_v2([1.35, 0.05, 0.0]);

        assert_in_gamut(mapped);
        assert!(
            mapped[1] > 0.05 || mapped[2] > 0.0,
            "perceptual mapping should reduce chroma, not only hard-clip red"
        );
    }

    #[test]
    fn mapper_handles_negative_components() {
        let mapped = map_srgb_oklab_chroma_reduce_v2([0.1, -0.2, 0.8]);

        assert_in_gamut(mapped);
    }

    #[test]
    fn mapper_v2_fits_hdr_neutral_without_channel_clip_shape() {
        let mapped = map_srgb_oklab_chroma_reduce_v2([1.8, 1.8, 1.8]);

        assert_in_gamut(mapped);
        assert!(
            (mapped[0] - mapped[1]).abs() <= 1.0e-5 && (mapped[1] - mapped[2]).abs() <= 1.0e-5,
            "v2 should preserve neutral-axis balance while fitting HDR values"
        );
    }

    #[test]
    fn mapper_v1_remains_available_as_historical_id() {
        assert_in_gamut(map_srgb_oklab_chroma_reduce_v1([1.35, 0.05, 0.0]));
    }
}
