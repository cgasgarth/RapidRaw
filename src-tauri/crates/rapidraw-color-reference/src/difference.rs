use std::f64::consts::{PI, TAU};

use crate::{
    ReferenceError,
    types::{CieLab, DeltaEItp, ICtCp},
};

#[must_use]
pub fn delta_e_76(left: CieLab, right: CieLab) -> f64 {
    ((left.lightness - right.lightness).powi(2)
        + (left.a - right.a).powi(2)
        + (left.b - right.b).powi(2))
    .sqrt()
}

fn hue_angle(b: f64, a_prime: f64) -> f64 {
    b.atan2(a_prime).rem_euclid(TAU)
}

/// CIEDE2000 from Sharma, Wu, and Dalal (2005), DOI 10.1002/col.20070.
#[must_use]
pub fn delta_e_2000(left: CieLab, right: CieLab) -> f64 {
    let c1 = left.a.hypot(left.b);
    let c2 = right.a.hypot(right.b);
    let c_bar = (c1 + c2) / 2.0;
    let c_bar_7 = c_bar.powi(7);
    let g = 0.5 * (1.0 - (c_bar_7 / (c_bar_7 + 25_f64.powi(7))).sqrt());
    let a1_prime = (1.0 + g) * left.a;
    let a2_prime = (1.0 + g) * right.a;
    let c1_prime = a1_prime.hypot(left.b);
    let c2_prime = a2_prime.hypot(right.b);
    let h1_prime = hue_angle(left.b, a1_prime);
    let h2_prime = hue_angle(right.b, a2_prime);
    let delta_l_prime = right.lightness - left.lightness;
    let delta_c_prime = c2_prime - c1_prime;
    let hue_difference = h2_prime - h1_prime;
    let delta_h_prime = if c1_prime * c2_prime == 0.0 {
        0.0
    } else if hue_difference.abs() <= PI {
        hue_difference
    } else if hue_difference > PI {
        hue_difference - TAU
    } else {
        hue_difference + TAU
    };
    let delta_big_h_prime = 2.0 * (c1_prime * c2_prime).sqrt() * (delta_h_prime / 2.0).sin();
    let l_bar_prime = (left.lightness + right.lightness) / 2.0;
    let c_bar_prime = (c1_prime + c2_prime) / 2.0;
    let h_bar_prime = if c1_prime * c2_prime == 0.0 {
        h1_prime + h2_prime
    } else if hue_difference.abs() <= PI {
        (h1_prime + h2_prime) / 2.0
    } else if h1_prime + h2_prime < TAU {
        (h1_prime + h2_prime + TAU) / 2.0
    } else {
        (h1_prime + h2_prime - TAU) / 2.0
    };
    let t = 1.0 - 0.17 * (h_bar_prime - PI / 6.0).cos()
        + 0.24 * (2.0 * h_bar_prime).cos()
        + 0.32 * (3.0 * h_bar_prime + PI / 30.0).cos()
        - 0.20 * (4.0 * h_bar_prime - 7.0 * PI / 20.0).cos();
    let delta_theta = PI / 6.0 * (-(((h_bar_prime.to_degrees() - 275.0) / 25.0).powi(2))).exp();
    let l_offset = l_bar_prime - 50.0;
    let s_l = 1.0 + 0.015 * l_offset.powi(2) / (20.0 + l_offset.powi(2)).sqrt();
    let s_c = 1.0 + 0.045 * c_bar_prime;
    let s_h = 1.0 + 0.015 * c_bar_prime * t;
    let r_c = 2.0 * (c_bar_prime.powi(7) / (c_bar_prime.powi(7) + 25_f64.powi(7))).sqrt();
    let r_t = -r_c * (2.0 * delta_theta).sin();
    let l_term = delta_l_prime / s_l;
    let c_term = delta_c_prime / s_c;
    let h_term = delta_big_h_prime / s_h;
    (l_term.powi(2) + c_term.powi(2) + h_term.powi(2) + r_t * c_term * h_term).sqrt()
}

/// ITU-R BT.2124 ΔEITP for dimensionless PQ-domain ICtCp coordinates.
pub fn delta_e_itp(left: ICtCp, right: ICtCp) -> Result<DeltaEItp, ReferenceError> {
    let delta_i = left.intensity - right.intensity;
    let delta_t = left.tritan - right.tritan;
    let delta_p = left.protan - right.protan;
    DeltaEItp::new(720.0 * (delta_i.powi(2) + 0.25 * delta_t.powi(2) + delta_p.powi(2)).sqrt())
}
