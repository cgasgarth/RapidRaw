pub(crate) const LEGACY_FIXED_BAND_V1: u32 = 0;
pub(crate) const NEUTRAL_PANCHROMATIC_V1: u32 = 1;
pub(crate) const MONOCHROME_IMPLEMENTATION_VERSION_V1: u32 = 1;

const ACESCG_NEUTRAL_MIX: [f32; 3] = [0.272_228_72, 0.674_081_74, 0.053_689_52];
const RGBA16F_FINITE_LIMIT: f32 = 65_504.0;

pub(crate) fn neutral_panchromatic_v1(color: [f32; 3]) -> [f32; 3] {
    let sanitized = color.map(|channel| {
        if channel.is_finite() {
            channel.clamp(-RGBA16F_FINITE_LIMIT, RGBA16F_FINITE_LIMIT)
        } else {
            0.0
        }
    });
    let energy = sanitized[0] * ACESCG_NEUTRAL_MIX[0]
        + sanitized[1] * ACESCG_NEUTRAL_MIX[1]
        + sanitized[2] * ACESCG_NEUTRAL_MIX[2];
    [energy; 3]
}

#[cfg(test)]
mod tests {
    use super::neutral_panchromatic_v1;

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
}
