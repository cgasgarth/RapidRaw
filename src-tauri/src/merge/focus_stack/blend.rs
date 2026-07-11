use super::{
    focus_measure::ResponseStack,
    labels::{FocusMaps, INVALID},
    pyramid::{self, Plane},
};

pub(crate) const POLICY_ID: &str = "focus_laplacian_owner_blend_v1";

#[derive(Clone, Debug)]
pub(crate) struct BlendResult {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<[f32; 3]>,
    pub weights: Vec<Vec<f32>>,
    pub source_indices: Vec<usize>,
    pub edge_owner: Vec<u16>,
    pub fallback: Vec<u8>,
    pub halo_risk: Vec<u8>,
    pub ownership_ambiguous: Vec<u8>,
    pub levels: usize,
    pub effective_owner_radius_px: u32,
    pub owner_expanded_pixels: u64,
}

pub(crate) fn fuse(
    stack: &ResponseStack,
    maps: &FocusMaps,
    reference_source_index: usize,
    strength_percent: u8,
    cancelled: impl Fn() -> bool + Copy,
) -> Result<BlendResult, String> {
    let width = stack.width as usize;
    let height = stack.height as usize;
    let count = width * height;
    let levels = pyramid::level_count(width, height);
    let radius = ((strength_percent.min(100) as f32 * 8.0 / 100.0).round() as u32).min(8);
    let mut owners = maps.winner_source.clone();
    let original = owners.clone();
    let mut ambiguous = vec![0; count];
    let mut halo_risk = vec![0; count];
    for index in 0..count {
        if is_transition(&maps.winner_source, width, height, index) {
            let reliable = maps.label_confidence[index] >= 0.35 && maps.occlusion_risk[index] == 0;
            ambiguous[index] = u8::from(!reliable);
            halo_risk[index] = u8::from(!reliable || maps.winner_margin[index] < 0.25);
        }
    }
    for _ in 0..radius {
        let prior = owners.clone();
        for (index, owner) in owners.iter_mut().enumerate() {
            if maps.occlusion_risk[index] != 0 || maps.fallback_required[index] != 0 {
                continue;
            }
            let candidate = neighbor_owner(&prior, maps, width, height, index);
            if let Some(candidate_owner) = candidate {
                *owner = candidate_owner;
            }
        }
    }
    let expanded = owners
        .iter()
        .zip(original)
        .filter(|(a, b)| **a != *b)
        .count() as u64;
    let reference_slot = stack
        .sources
        .iter()
        .position(|s| s.source_index == reference_source_index)
        .ok_or("focus_blend_reference_missing")?;
    let mut fallback = vec![0; count];
    let mut base_weights = vec![vec![0.0; count]; stack.sources.len()];
    for index in 0..count {
        let force_reference = maps.fallback_required[index] != 0 || maps.occlusion_risk[index] != 0;
        let owner_slot = (!force_reference)
            .then(|| owners[index])
            .filter(|v| *v != INVALID)
            .and_then(|owner| {
                stack
                    .sources
                    .iter()
                    .position(|s| s.source_index == owner as usize && s.valid[index])
            });
        let slot = owner_slot
            .or_else(|| stack.sources[reference_slot].valid[index].then_some(reference_slot))
            .or_else(|| stack.sources.iter().position(|s| s.valid[index]))
            .ok_or("focus_blend_no_valid_sample")?;
        owners[index] = stack.sources[slot].source_index as u16;
        fallback[index] =
            u8::from(slot == reference_slot && (force_reference || owner_slot.is_none()));
        base_weights[slot][index] = 1.0;
    }
    let weight_pyramids = base_weights
        .into_iter()
        .map(|values| {
            pyramid::gaussian(
                Plane {
                    width,
                    height,
                    values,
                },
                levels,
            )
        })
        .collect::<Vec<_>>();
    let mut channels = Vec::with_capacity(3);
    for channel in 0..3 {
        if cancelled() {
            return Err("focus_stack_plan_cancelled:pyramid_construction".into());
        }
        let source_pyramids = stack
            .sources
            .iter()
            .map(|source| {
                pyramid::laplacian(
                    Plane {
                        width,
                        height,
                        values: source.rgb.iter().map(|rgb| rgb[channel]).collect(),
                    },
                    levels,
                )
            })
            .collect::<Vec<_>>();
        let mut blended = Vec::with_capacity(levels);
        for level in 0..levels {
            let dimensions = &source_pyramids[0][level];
            let mut values = vec![0.0; dimensions.values.len()];
            for (index, value) in values.iter_mut().enumerate() {
                let fine = level < 2;
                let x = index % dimensions.width;
                let y = index / dimensions.width;
                let full_index = (y << level).min(height - 1) * width + (x << level).min(width - 1);
                let owner = stack
                    .sources
                    .iter()
                    .position(|s| s.source_index == owners[full_index] as usize);
                let mut sum = 0.0;
                for source in 0..stack.sources.len() {
                    let weight = if fine {
                        f32::from(Some(source) == owner)
                    } else {
                        weight_pyramids[source][level].values[index]
                    };
                    *value += source_pyramids[source][level].values[index] * weight;
                    sum += weight;
                }
                if sum > 0.0 {
                    *value /= sum;
                }
            }
            blended.push(Plane {
                width: dimensions.width,
                height: dimensions.height,
                values,
            });
        }
        channels.push(pyramid::reconstruct(&blended).values);
    }
    let pixels = (0..count)
        .map(|i| [channels[0][i], channels[1][i], channels[2][i]])
        .collect::<Vec<_>>();
    if pixels.iter().flatten().any(|v| !v.is_finite()) {
        return Err("focus_blend_nonfinite_output".into());
    }
    let weights = (0..stack.sources.len())
        .map(|source| {
            (0..count)
                .map(|i| weight_pyramids[source][0].values[i])
                .collect()
        })
        .collect();
    Ok(BlendResult {
        width: stack.width,
        height: stack.height,
        pixels,
        weights,
        source_indices: stack
            .sources
            .iter()
            .map(|source| source.source_index)
            .collect(),
        edge_owner: owners,
        fallback,
        halo_risk,
        ownership_ambiguous: ambiguous,
        levels,
        effective_owner_radius_px: radius,
        owner_expanded_pixels: expanded,
    })
}

fn is_transition(labels: &[u16], width: usize, height: usize, i: usize) -> bool {
    let x = i % width;
    let y = i / width;
    [
        x.checked_sub(1).map(|_| i - 1),
        (x + 1 < width).then_some(i + 1),
        y.checked_sub(1).map(|_| i - width),
        (y + 1 < height).then_some(i + width),
    ]
    .into_iter()
    .flatten()
    .any(|n| labels[n] != labels[i])
}
fn neighbor_owner(
    owners: &[u16],
    maps: &FocusMaps,
    width: usize,
    height: usize,
    i: usize,
) -> Option<u16> {
    let x = i % width;
    let y = i / width;
    [
        x.checked_sub(1).map(|_| i - 1),
        (x + 1 < width).then_some(i + 1),
        y.checked_sub(1).map(|_| i - width),
        (y + 1 < height).then_some(i + width),
    ]
    .into_iter()
    .flatten()
    .filter(|n| owners[*n] != INVALID && maps.label_confidence[*n] > maps.label_confidence[i] + 0.1)
    .max_by(|a, b| maps.winner_response[*a].total_cmp(&maps.winner_response[*b]))
    .map(|n| owners[n])
}

#[cfg(test)]
mod tests {
    use super::super::pyramid::{Plane, laplacian, reconstruct};

    #[test]
    fn focus_stack_blend_preserves_extended_linear_highlights() {
        let input = Plane {
            width: 32,
            height: 24,
            values: (0..768)
                .map(|i| if i == 400 { 2.75 } else { 0.2 })
                .collect(),
        };
        let output = reconstruct(&laplacian(input, 5));
        assert!((output.values[400] - 2.75).abs() < 1e-5);
    }
}
