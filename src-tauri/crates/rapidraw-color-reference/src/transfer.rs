use crate::{
    ReferenceError,
    types::{
        AbsoluteLuminanceNits, EncodedRec2020, EncodedSrgb, HlgSignal, LinearRgb, PqSignal,
        SceneLinearHlg,
    },
};

const REC2020_ALPHA: f64 = 1.099_296_826_809_44;
const REC2020_BETA: f64 = 0.018_053_968_510_807;

/// IEC 61966-2-1 sRGB decoding equation, extended outside [0, 1] without clamping.
#[must_use]
pub fn srgb_to_linear_channel(encoded: f64) -> f64 {
    if encoded <= 0.04045 {
        encoded / 12.92
    } else {
        ((encoded + 0.055) / 1.055).powf(2.4)
    }
}

/// IEC 61966-2-1 sRGB encoding equation, extended outside [0, 1] without clamping.
#[must_use]
pub fn linear_to_srgb_channel(linear: f64) -> f64 {
    if linear <= 0.003_130_8 {
        12.92 * linear
    } else {
        1.055 * linear.powf(1.0 / 2.4) - 0.055
    }
}

pub fn decode_srgb(encoded: EncodedSrgb) -> Result<LinearRgb, ReferenceError> {
    LinearRgb::new(
        srgb_to_linear_channel(encoded.red),
        srgb_to_linear_channel(encoded.green),
        srgb_to_linear_channel(encoded.blue),
    )
}

pub fn encode_srgb(linear: LinearRgb) -> Result<EncodedSrgb, ReferenceError> {
    EncodedSrgb::new(
        linear_to_srgb_channel(linear.red),
        linear_to_srgb_channel(linear.green),
        linear_to_srgb_channel(linear.blue),
    )
}

/// ITU-R BT.2020-2 12-bit reference OETF, extended without clamping.
#[must_use]
pub fn linear_to_rec2020_channel(linear: f64) -> f64 {
    if linear < REC2020_BETA {
        4.5 * linear
    } else {
        REC2020_ALPHA * linear.powf(0.45) - (REC2020_ALPHA - 1.0)
    }
}

/// Inverse ITU-R BT.2020-2 12-bit reference OETF, extended without clamping.
#[must_use]
pub fn rec2020_to_linear_channel(encoded: f64) -> f64 {
    if encoded < 4.5 * REC2020_BETA {
        encoded / 4.5
    } else {
        ((encoded + REC2020_ALPHA - 1.0) / REC2020_ALPHA).powf(1.0 / 0.45)
    }
}

pub fn encode_rec2020(linear: LinearRgb) -> Result<EncodedRec2020, ReferenceError> {
    EncodedRec2020::new(
        linear_to_rec2020_channel(linear.red),
        linear_to_rec2020_channel(linear.green),
        linear_to_rec2020_channel(linear.blue),
    )
}

pub fn decode_rec2020(encoded: EncodedRec2020) -> Result<LinearRgb, ReferenceError> {
    LinearRgb::new(
        rec2020_to_linear_channel(encoded.red),
        rec2020_to_linear_channel(encoded.green),
        rec2020_to_linear_channel(encoded.blue),
    )
}

/// SMPTE ST 2084 EOTF. Output is absolute display luminance in cd/m² (nits).
pub fn pq_eotf(signal: PqSignal) -> Result<AbsoluteLuminanceNits, ReferenceError> {
    let m1 = 2610.0 / 16_384.0;
    let m2 = 2523.0 / 32.0;
    let c1 = 3424.0 / 4096.0;
    let c2 = 2413.0 / 128.0;
    let c3 = 2392.0 / 128.0;
    let power = signal.value().powf(1.0 / m2);
    let denominator = c2 - c3 * power;
    if denominator <= 0.0 {
        return Err(ReferenceError::UndefinedTransferDomain);
    }
    AbsoluteLuminanceNits::new(10_000.0 * ((power - c1).max(0.0) / denominator).powf(1.0 / m1))
}

/// Inverse SMPTE ST 2084 EOTF from absolute cd/m²; values above 10,000 are not clamped.
pub fn pq_inverse_eotf(luminance: AbsoluteLuminanceNits) -> Result<PqSignal, ReferenceError> {
    let m1 = 2610.0 / 16_384.0;
    let m2 = 2523.0 / 32.0;
    let c1 = 3424.0 / 4096.0;
    let c2 = 2413.0 / 128.0;
    let c3 = 2392.0 / 128.0;
    let power = (luminance.value() / 10_000.0).powf(m1);
    PqSignal::new(((c1 + c2 * power) / (1.0 + c3 * power)).powf(m2))
}

const HLG_A: f64 = 0.178_832_77;
const HLG_B: f64 = 1.0 - 4.0 * HLG_A;
const HLG_C: f64 = 0.559_910_73;

/// ITU-R BT.2100 HLG OETF from nonnegative scene-linear light; over-range is preserved.
pub fn hlg_oetf(linear: SceneLinearHlg) -> Result<HlgSignal, ReferenceError> {
    let value = linear.value();
    HlgSignal::new(if value <= 1.0 / 12.0 {
        (3.0 * value).sqrt()
    } else {
        HLG_A * (12.0 * value - HLG_B).ln() + HLG_C
    })
}

/// Inverse ITU-R BT.2100 HLG OETF; signal values above 1.0 are not clamped.
pub fn hlg_inverse_oetf(signal: HlgSignal) -> Result<SceneLinearHlg, ReferenceError> {
    let value = signal.value();
    SceneLinearHlg::new(if value <= 0.5 {
        value.powi(2) / 3.0
    } else {
        (((value - HLG_C) / HLG_A).exp() + HLG_B) / 12.0
    })
}
