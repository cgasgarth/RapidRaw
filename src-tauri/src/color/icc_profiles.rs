use moxcms::{
    CicpColorPrimaries, CicpProfile, ColorProfile, MatrixCoefficients, TransferCharacteristics,
};

pub(crate) fn standardized_srgb_profile() -> ColorProfile {
    with_rgb_cicp(ColorProfile::new_srgb(), CicpColorPrimaries::Bt709)
}

pub(crate) fn standardized_display_p3_profile() -> ColorProfile {
    with_rgb_cicp(ColorProfile::new_display_p3(), CicpColorPrimaries::Smpte432)
}

fn with_rgb_cicp(mut profile: ColorProfile, color_primaries: CicpColorPrimaries) -> ColorProfile {
    profile.cicp = Some(CicpProfile {
        color_primaries,
        transfer_characteristics: TransferCharacteristics::Srgb,
        matrix_coefficients: MatrixCoefficients::Identity,
        full_range: true,
    });
    profile
}
