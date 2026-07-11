use super::focus_measure::ResponseStack;

pub(crate) const POLICY_ID: &str = "focus_edge_aware_icm_v1";
pub(crate) const INVALID: u16 = u16::MAX;

#[derive(Clone, Debug)]
pub(crate) struct FocusMaps {
    pub width: u32,
    pub height: u32,
    pub winner_source: Vec<u16>,
    pub runner_up_source: Vec<u16>,
    pub winner_response: Vec<f32>,
    pub runner_up_response: Vec<f32>,
    pub winner_margin: Vec<f32>,
    pub label_confidence: Vec<f32>,
    pub valid_source_count: Vec<u16>,
    pub low_texture: Vec<u8>,
    pub clipped_or_defective: Vec<u8>,
    pub alignment_risk: Vec<u8>,
    pub occlusion_risk: Vec<u8>,
    pub fallback_required: Vec<u8>,
    pub changed_pixel_count: u64,
}

pub(crate) fn select_and_regularize(
    stack: &ResponseStack,
    cancelled: impl Fn() -> bool + Copy,
) -> Result<FocusMaps, String> {
    let count = stack.width as usize * stack.height as usize;
    let mut maps = FocusMaps {
        width: stack.width,
        height: stack.height,
        winner_source: vec![INVALID; count],
        runner_up_source: vec![INVALID; count],
        winner_response: vec![0.0; count],
        runner_up_response: vec![0.0; count],
        winner_margin: vec![0.0; count],
        label_confidence: vec![0.0; count],
        valid_source_count: vec![0; count],
        low_texture: vec![0; count],
        clipped_or_defective: vec![0; count],
        alignment_risk: vec![0; count],
        occlusion_risk: vec![0; count],
        fallback_required: vec![0; count],
        changed_pixel_count: 0,
    };
    for index in 0..count {
        let mut candidates = stack
            .responses
            .iter()
            .enumerate()
            .filter_map(|(slot, response)| {
                response[index].is_finite().then_some((
                    slot,
                    stack.sources[slot].source_index as u16,
                    response[index],
                ))
            })
            .collect::<Vec<_>>();
        candidates.sort_by(|a, b| b.2.total_cmp(&a.2).then_with(|| a.1.cmp(&b.1)));
        maps.valid_source_count[index] = candidates.len() as u16;
        maps.clipped_or_defective[index] = u8::from(
            stack
                .sources
                .iter()
                .any(|source| source.clipped[index] || !source.valid[index]),
        );
        let Some(&(winner_slot, winner, winner_response)) = candidates.first() else {
            maps.fallback_required[index] = 1;
            continue;
        };
        let runner = candidates.get(1).copied();
        maps.winner_source[index] = winner;
        maps.winner_response[index] = winner_response.max(0.0);
        if let Some((_, source, response)) = runner {
            maps.runner_up_source[index] = source;
            maps.runner_up_response[index] = response.max(0.0);
        }
        let margin = ((winner_response - runner.map_or(0.0, |v| v.2)) / winner_response.max(1e-6))
            .clamp(0.0, 1.0);
        maps.winner_margin[index] = margin;
        let low_texture = winner_response < stack.policy.evidence_floor;
        maps.low_texture[index] = u8::from(low_texture);
        let alignment = stack.sources[winner_slot].alignment_confidence;
        maps.alignment_risk[index] = u8::from(alignment < 0.7);
        let scale_disagreement = stack
            .scale_winners
            .iter()
            .any(|scale| scale[index] != winner);
        let residual = runner.map_or(0.0, |(runner_slot, _, _)| {
            stack.sources[winner_slot].rgb[index]
                .iter()
                .zip(stack.sources[runner_slot].rgb[index])
                .map(|(winner, runner)| (*winner - runner).abs())
                .sum::<f32>()
                / 3.0
        });
        let edge = gradient(
            &stack.reference_luma,
            stack.width as usize,
            stack.height as usize,
            index,
        );
        maps.occlusion_risk[index] =
            u8::from(scale_disagreement || residual > 0.12 || (edge > 0.08 && margin < 0.2));
        let evidence =
            (winner_response / (winner_response + stack.policy.evidence_floor)).clamp(0.0, 1.0);
        maps.label_confidence[index] =
            (margin * evidence * alignment * (1.0 - 0.55 * maps.occlusion_risk[index] as f32))
                .clamp(0.0, 1.0);
        if low_texture || candidates.len() < 2 {
            maps.winner_source[index] = INVALID;
            maps.fallback_required[index] = 1;
            maps.label_confidence[index] = 0.0;
        }
    }
    regularize(&mut maps, stack, cancelled)?;
    dilate_risk(&mut maps, stack.policy.support_radius as usize);
    Ok(maps)
}

fn regularize(
    maps: &mut FocusMaps,
    stack: &ResponseStack,
    cancelled: impl Fn() -> bool + Copy,
) -> Result<(), String> {
    let width = maps.width as usize;
    let height = maps.height as usize;
    let raw = maps.winner_source.clone();
    for _ in 0..4 {
        for reverse in [false, true] {
            if cancelled() {
                return Err("focus_stack_plan_cancelled:label_regularization".into());
            }
            let range: Box<dyn Iterator<Item = usize>> = if reverse {
                Box::new((0..raw.len()).rev())
            } else {
                Box::new(0..raw.len())
            };
            for index in range {
                if raw[index] == INVALID {
                    continue;
                }
                let x = index % width;
                let y = index / width;
                let mut candidates = vec![raw[index], maps.runner_up_source[index]];
                for ny in y.saturating_sub(1)..=(y + 1).min(height - 1) {
                    for nx in x.saturating_sub(1)..=(x + 1).min(width - 1) {
                        candidates.push(maps.winner_source[ny * width + nx]);
                    }
                }
                candidates.sort_unstable();
                candidates.dedup();
                candidates.retain(|label| *label != INVALID);
                let edge = gradient(&stack.reference_luma, width, height, index);
                let smooth = 0.18 * (1.0 - edge * 5.0).clamp(0.05, 1.0);
                let best = candidates
                    .into_iter()
                    .filter_map(|label| {
                        let slot = stack
                            .sources
                            .iter()
                            .position(|source| source.source_index as u16 == label)?;
                        let response = stack.responses[slot][index];
                        if !response.is_finite() {
                            return None;
                        }
                        let data = 1.0 - response / maps.winner_response[index].max(1e-6);
                        let neighbors = [
                            x.checked_sub(1).map(|v| y * width + v),
                            (x + 1 < width).then_some(y * width + x + 1),
                            y.checked_sub(1).map(|v| v * width + x),
                            (y + 1 < height).then_some((y + 1) * width + x),
                        ];
                        let potts = neighbors
                            .into_iter()
                            .flatten()
                            .filter(|neighbor| maps.winner_source[*neighbor] != label)
                            .count() as f32
                            * smooth;
                        Some((label, data + potts))
                    })
                    .min_by(|a, b| a.1.total_cmp(&b.1).then_with(|| a.0.cmp(&b.0)));
                if let Some((label, _)) = best {
                    maps.winner_source[index] = label;
                }
            }
        }
    }
    maps.changed_pixel_count = raw
        .iter()
        .zip(&maps.winner_source)
        .filter(|(a, b)| a != b)
        .count() as u64;
    Ok(())
}

fn dilate_risk(maps: &mut FocusMaps, radius: usize) {
    let width = maps.width as usize;
    let height = maps.height as usize;
    let risk = (0..maps.winner_source.len())
        .map(|i| maps.alignment_risk[i] != 0 || maps.occlusion_risk[i] != 0)
        .collect::<Vec<_>>();
    for (index, _) in risk.iter().enumerate().filter(|(_, v)| **v) {
        let x = index % width;
        let y = index / width;
        for ny in y.saturating_sub(radius)..=(y + radius).min(height - 1) {
            for nx in x.saturating_sub(radius)..=(x + radius).min(width - 1) {
                let i = ny * width + nx;
                maps.occlusion_risk[i] = 1;
                maps.label_confidence[i] *= 0.45;
                if maps.label_confidence[i] < 0.12 {
                    maps.fallback_required[i] = 1;
                }
            }
        }
    }
}

fn gradient(values: &[f32], width: usize, height: usize, index: usize) -> f32 {
    let x = index % width;
    let y = index / width;
    if x == 0 || y == 0 || x + 1 >= width || y + 1 >= height {
        return 0.0;
    }
    let gx = values[index + 1] - values[index - 1];
    let gy = values[index + width] - values[index - width];
    gx.mul_add(gx, gy * gy).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::merge::focus_stack::focus_measure::{
        AlignedSource, FocusMeasurePolicy, ResponseStack,
    };
    #[test]
    fn stable_ties_and_textureless_pixels_are_explicit() {
        let source = |index| AlignedSource {
            source_index: index,
            luma: vec![0.2; 16],
            rgb: vec![[0.2; 3]; 16],
            valid: vec![true; 16],
            clipped: vec![false; 16],
            noise_sigma: 0.01,
            alignment_confidence: 1.0,
        };
        let stack = ResponseStack {
            width: 4,
            height: 4,
            sources: vec![source(0), source(1)],
            responses: vec![vec![4.0; 16], vec![4.0; 16]],
            scale_winners: vec![vec![0; 16]; 3],
            reference_luma: vec![0.2; 16],
            policy: FocusMeasurePolicy::default(),
        };
        let maps = select_and_regularize(&stack, || false).unwrap();
        assert!(maps.winner_source.iter().all(|v| *v == 0));
        let mut low = stack;
        low.responses = vec![vec![0.1; 16], vec![0.05; 16]];
        let maps = select_and_regularize(&low, || false).unwrap();
        assert!(maps.winner_source.iter().all(|v| *v == INVALID));
        assert!(maps.fallback_required.iter().all(|v| *v == 1));
    }
}
