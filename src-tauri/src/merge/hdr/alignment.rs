use super::source_frame::AlignmentProxy;

pub(crate) const ALIGNMENT_POLICY_ID: &str = "bounded_ncc_translation_v1";
const MAX_SHIFT: i32 = 48;

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AlignmentReceipt {
    pub confidence: f32,
    pub converged: bool,
    pub iterations: usize,
    pub matrix: [f32; 9],
    pub model: &'static str,
    pub overlap_fraction: f32,
    pub policy_id: &'static str,
    pub residual_p95: f32,
    pub residual_rms: f32,
}

fn score(
    reference: &AlignmentProxy,
    candidate: &AlignmentProxy,
    dx: i32,
    dy: i32,
) -> Option<(f64, usize)> {
    if reference.width != candidate.width || reference.height != candidate.height {
        return None;
    }
    let mut sum_a = 0.0f64;
    let mut sum_b = 0.0f64;
    let mut sum_aa = 0.0f64;
    let mut sum_bb = 0.0f64;
    let mut sum_ab = 0.0f64;
    let mut count = 0usize;
    for y in 0..reference.height as i32 {
        let cy = y + dy;
        if !(0..candidate.height as i32).contains(&cy) {
            continue;
        }
        for x in 0..reference.width as i32 {
            let cx = x + dx;
            if !(0..candidate.width as i32).contains(&cx) {
                continue;
            }
            let a = reference.pixels[y as usize * reference.width + x as usize] as f64;
            let b = candidate.pixels[cy as usize * candidate.width + cx as usize] as f64;
            if a <= 0.0 || b <= 0.0 {
                continue;
            }
            sum_a += a;
            sum_b += b;
            sum_aa += a * a;
            sum_bb += b * b;
            sum_ab += a * b;
            count += 1;
        }
    }
    if count < 256 {
        return None;
    }
    let n = count as f64;
    let covariance = sum_ab - sum_a * sum_b / n;
    let variance = ((sum_aa - sum_a * sum_a / n) * (sum_bb - sum_b * sum_b / n)).sqrt();
    (variance > 1e-12).then_some((covariance / variance, count))
}

pub(crate) fn align(
    reference: &AlignmentProxy,
    candidate: &AlignmentProxy,
) -> Result<AlignmentReceipt, String> {
    let search_radius = ((MAX_SHIFT as f32 / reference.scale).ceil() as i32).max(1);
    let mut best = (-2.0f64, 0i32, 0i32, 0usize);
    let mut second = -2.0f64;
    for dy in -search_radius..=search_radius {
        for dx in -search_radius..=search_radius {
            if let Some((value, count)) = score(reference, candidate, dx, dy) {
                if value > best.0 + 1e-9 || ((value - best.0).abs() <= 1e-9 && count > best.3) {
                    second = best.0;
                    best = (value, dx, dy, count);
                } else if value > second {
                    second = value;
                }
            }
        }
    }
    let overlap = best.3 as f32 / (reference.width * reference.height) as f32;
    if best.0 < 0.55 || overlap < 0.55 {
        return Err("unstable_transform".to_string());
    }
    let scale = reference.scale;
    let confidence = ((best.0 - second).max(0.0) * 10.0).min(1.0) as f32;
    Ok(AlignmentReceipt {
        confidence,
        converged: true,
        iterations: ((search_radius * 2 + 1) * (search_radius * 2 + 1)) as usize,
        matrix: [
            1.0,
            0.0,
            -(best.1 as f32) * scale,
            0.0,
            1.0,
            -(best.2 as f32) * scale,
            0.0,
            0.0,
            1.0,
        ],
        model: "translation",
        overlap_fraction: overlap,
        policy_id: ALIGNMENT_POLICY_ID,
        residual_p95: (1.0 - best.0 as f32) * scale,
        residual_rms: (1.0 - best.0 as f32) * scale * 0.67,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recovers_deterministic_translation() {
        let pixels = (0..64 * 64)
            .map(|i| (((i * 7919) % 997) as f32) / 997.0 + 0.01)
            .collect::<Vec<_>>();
        let reference = AlignmentProxy {
            width: 64,
            height: 64,
            scale: 1.0,
            pixels: pixels.clone(),
        };
        let mut shifted = vec![0.0; pixels.len()];
        for y in 0..61 {
            for x in 2..64 {
                shifted[(y + 3) * 64 + (x - 2)] = pixels[y * 64 + x];
            }
        }
        let candidate = AlignmentProxy {
            width: 64,
            height: 64,
            scale: 1.0,
            pixels: shifted,
        };
        let receipt = align(&reference, &candidate).unwrap_or_else(|error| {
            panic!(
                "{error}; expected score={:?}",
                score(&reference, &candidate, -2, 3)
            )
        });
        assert_eq!(receipt.matrix[2], 2.0);
        assert_eq!(receipt.matrix[5], -3.0);
    }
}
