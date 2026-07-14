pub(crate) const LEGACY_FIXED_BAND_V1: u32 = 0;
pub(crate) const NEUTRAL_PANCHROMATIC_V1: u32 = 1;
pub(crate) const CONTINUOUS_SENSITIVITY_V1: u32 = 2;
pub(crate) const MONOCHROME_IMPLEMENTATION_VERSION_V1: u32 = 1;

const ACESCG_NEUTRAL_MIX: [f32; 3] = [0.272_228_72, 0.674_081_74, 0.053_689_52];
const RGBA16F_FINITE_LIMIT: f32 = 65_504.0;
const SENSITIVITY_HUE_ANCHORS: [f32; 8] = [0.0, 25.0, 60.0, 115.0, 180.0, 225.0, 280.0, 330.0];
const AP1_TO_LINEAR_SRGB_D65: [[f32; 3]; 3] = [
    [1.705_051_5, -0.621_790_7, -0.083_258_4],
    [-0.130_257_1, 1.140_802_9, -0.010_548_5],
    [-0.024_003_3, -0.128_968_8, 1.152_971_7],
];

pub(crate) fn neutral_panchromatic_v1(color: [f32; 3]) -> [f32; 3] {
    let sanitized = sanitize_scene_color(color);
    let energy = sanitized[0] * ACESCG_NEUTRAL_MIX[0]
        + sanitized[1] * ACESCG_NEUTRAL_MIX[1]
        + sanitized[2] * ACESCG_NEUTRAL_MIX[2];
    [energy; 3]
}

pub(crate) fn continuous_sensitivity_v1(color: [f32; 3], response_ev: [f32; 8]) -> [f32; 3] {
    let sanitized = sanitize_scene_color(color);
    let base = neutral_panchromatic_v1(sanitized)[0];
    let linear_srgb = multiply(AP1_TO_LINEAR_SRGB_D65, sanitized);
    let lab = linear_srgb_to_oklab(linear_srgb);
    let chroma = lab[1].hypot(lab[2]);
    let chroma_gate = smoothstep(0.005, 0.08, chroma);
    let hue_degrees = lab[2].atan2(lab[1]).to_degrees().rem_euclid(360.0);
    let response = periodic_sensitivity_response(hue_degrees, response_ev) * chroma_gate;
    let monochrome = base * 2.0_f32.powf(response.clamp(-2.0, 2.0));
    [monochrome; 3]
}

pub(crate) fn periodic_sensitivity_response(hue_degrees: f32, response_ev: [f32; 8]) -> f32 {
    let hue = hue_degrees.rem_euclid(360.0);
    for index in 0..SENSITIVITY_HUE_ANCHORS.len() {
        let start = SENSITIVITY_HUE_ANCHORS[index];
        let next = (index + 1) % SENSITIVITY_HUE_ANCHORS.len();
        let end = if next == 0 {
            360.0
        } else {
            SENSITIVITY_HUE_ANCHORS[next]
        };
        if hue >= start && hue <= end {
            let position = (hue - start) / (end - start);
            let blend = 0.5 - 0.5 * (std::f32::consts::PI * position).cos();
            return response_ev[index] * (1.0 - blend) + response_ev[next] * blend;
        }
    }
    response_ev[0]
}

fn sanitize_scene_color(color: [f32; 3]) -> [f32; 3] {
    color.map(|channel| {
        if channel.is_finite() {
            channel.clamp(-RGBA16F_FINITE_LIMIT, RGBA16F_FINITE_LIMIT)
        } else {
            0.0
        }
    })
}

fn multiply(matrix: [[f32; 3]; 3], value: [f32; 3]) -> [f32; 3] {
    matrix.map(|row| row[0] * value[0] + row[1] * value[1] + row[2] * value[2])
}

fn linear_srgb_to_oklab(rgb: [f32; 3]) -> [f32; 3] {
    let l = (0.412_221_46 * rgb[0] + 0.536_332_55 * rgb[1] + 0.051_445_995 * rgb[2]).cbrt();
    let m = (0.211_903_5 * rgb[0] + 0.680_699_5 * rgb[1] + 0.107_396_96 * rgb[2]).cbrt();
    let s = (0.088_302_46 * rgb[0] + 0.281_718_85 * rgb[1] + 0.629_978_7 * rgb[2]).cbrt();
    [
        0.210_454_26 * l + 0.793_617_8 * m - 0.004_072_047 * s,
        1.977_998_5 * l - 2.428_592_2 * m + 0.450_593_7 * s,
        0.025_904_037 * l + 0.782_771_77 * m - 0.808_675_77 * s,
    ]
}

fn smoothstep(low: f32, high: f32, value: f32) -> f32 {
    let position = ((value - low) / (high - low)).clamp(0.0, 1.0);
    position * position * (3.0 - 2.0 * position)
}

#[cfg(test)]
mod tests {
    use super::{
        continuous_sensitivity_v1, neutral_panchromatic_v1, periodic_sensitivity_response,
    };

    #[test]
    fn neutral_v1_preserves_neutral_axis_exposure_and_scene_headroom() {
        let neutral = neutral_panchromatic_v1([0.42; 3]);
        assert_eq!(neutral, [neutral[0]; 3]);
        assert!((neutral[0] - 0.42).abs() <= 1.0e-7);

        let source = [2.5, 0.7, -0.2];
        let baseline = neutral_panchromatic_v1(source)[0];
        for exposure_ev in [-8.0_f32, 8.0] {
            let scale = 2.0_f32.powf(exposure_ev);
            let exposed = neutral_panchromatic_v1(source.map(|channel| channel * scale))[0];
            assert!((exposed - baseline * scale).abs() <= exposed.abs().max(1.0) * 2.0e-6);
        }

        assert!(neutral_panchromatic_v1([4.0, 2.0, 0.5])[0] > 1.0);
        assert!(neutral_panchromatic_v1([-4.0, -2.0, -0.5])[0] < 0.0);
    }

    #[test]
    fn neutral_v1_sanitizes_non_finite_and_storage_overflow_inputs() {
        for source in [
            [f32::NAN, 0.5, 0.25],
            [f32::INFINITY, 0.5, 0.25],
            [f32::MAX, f32::MIN, 1.0],
        ] {
            assert!(
                neutral_panchromatic_v1(source)
                    .iter()
                    .all(|value| value.is_finite())
            );
        }
    }

    #[test]
    fn continuous_response_wraps_smoothly_without_overshoot() {
        let response = [1.0, 0.4, -0.2, -0.8, -0.5, 0.2, 0.7, 0.9];
        let left = periodic_sensitivity_response(359.999, response);
        let right = periodic_sensitivity_response(0.001, response);
        assert!((left - right).abs() < 1.0e-4);
        for hue in 0..3600 {
            let value = periodic_sensitivity_response(hue as f32 / 10.0, response);
            assert!((-0.8..=1.0).contains(&value));
        }
    }

    #[test]
    fn continuous_process_preserves_neutrals_exposure_and_headroom() {
        let response = [1.0, -0.5, 0.8, -0.7, 0.4, -1.0, 0.6, -0.2];
        assert_eq!(continuous_sensitivity_v1([0.42; 3], response), [0.42; 3]);

        let source = [2.5, 0.7, 0.2];
        let baseline = continuous_sensitivity_v1(source, response)[0];
        let exposed = continuous_sensitivity_v1(source.map(|channel| channel * 4.0), response)[0];
        assert!((exposed - baseline * 4.0).abs() <= exposed.abs().max(1.0) * 3.0e-5);
        assert!(continuous_sensitivity_v1([4.0, 2.0, 0.5], response)[0] > 1.0);
    }

    #[test]
    fn continuous_process_separates_target_hues_and_stays_finite() {
        let response = [1.0, 0.8, 0.2, -0.5, -1.0, -0.6, 0.1, 0.7];
        let warm = continuous_sensitivity_v1([0.9, 0.1, 0.05], response);
        let cool = continuous_sensitivity_v1([0.05, 0.3, 0.9], response);
        assert!(warm[0] > cool[0]);
        for source in [[f32::NAN, 0.5, 0.25], [f32::INFINITY, -2.0, 4.0]] {
            assert!(
                continuous_sensitivity_v1(source, response)
                    .iter()
                    .all(|value| value.is_finite())
            );
        }
    }
}
