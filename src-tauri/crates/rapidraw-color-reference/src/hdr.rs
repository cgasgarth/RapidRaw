//! Independent HDR colorimetry equations.

use crate::{
    ReferenceError, finite,
    transfer::pq_inverse_eotf,
    types::{AbsoluteLuminanceNits, ICtCp},
};

/// Converts absolute-light Rec.2100 RGB in cd/m² to PQ-domain ICtCp.
///
/// Matrices are the exact integer-ratio forms from ITU-R BT.2100-3 Table 7.
/// Inputs are absolute display-linear values and are intentionally not normalized
/// to a mastering peak before the ST 2084 inverse EOTF.
pub fn rec2100_linear_nits_to_ictcp(rgb_nits: [f64; 3]) -> Result<ICtCp, ReferenceError> {
    finite(&rgb_nits)?;
    if rgb_nits.iter().any(|channel| *channel < 0.0) {
        return Err(ReferenceError::NegativeLuminance);
    }
    let [red, green, blue] = rgb_nits;
    let lms_nits = [
        (1688.0 * red + 2146.0 * green + 262.0 * blue) / 4096.0,
        (683.0 * red + 2951.0 * green + 462.0 * blue) / 4096.0,
        (99.0 * red + 309.0 * green + 3688.0 * blue) / 4096.0,
    ];
    let lms_pq = lms_nits.map(|value| {
        pq_inverse_eotf(AbsoluteLuminanceNits::new(value)?).map(|signal| signal.value())
    });
    let [l_prime, m_prime, s_prime] = [lms_pq[0]?, lms_pq[1]?, lms_pq[2]?];
    ICtCp::new(
        (2048.0 * l_prime + 2048.0 * m_prime) / 4096.0,
        (6610.0 * l_prime - 13613.0 * m_prime + 7003.0 * s_prime) / 4096.0,
        (17933.0 * l_prime - 17390.0 * m_prime - 543.0 * s_prime) / 4096.0,
    )
}
