pub(crate) const OWNERSHIP_ALGORITHM_ID: &str = "deterministic_source_ownership_v1";
pub(crate) const UNRESOLVED_OWNER: u16 = u16::MAX;

#[derive(Clone, Copy, Debug)]
pub(crate) struct Candidate {
    pub alignment_confidence: f32,
    pub clipped: bool,
    pub is_reference: bool,
    pub source_index: usize,
    pub valid: bool,
    pub value: f32,
}

pub(crate) fn select(candidates: &[Candidate]) -> (u16, f32) {
    let mut ranked = candidates
        .iter()
        .filter(|candidate| candidate.valid && !candidate.clipped && candidate.value.is_finite())
        .map(|candidate| {
            let signal_quality = candidate.value.max(0.0) / (candidate.value.max(0.0) + 0.02);
            let score = signal_quality * 0.65
                + candidate.alignment_confidence.clamp(0.0, 1.0) * 0.2
                + if candidate.is_reference { 0.15 } else { 0.0 };
            (score, candidate.source_index)
        })
        .collect::<Vec<_>>();
    ranked.sort_by(|a, b| b.0.total_cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
    let Some((best, source_index)) = ranked.first().copied() else {
        return (UNRESOLVED_OWNER, 0.0);
    };
    let runner_up = ranked.get(1).map(|entry| entry.0).unwrap_or(0.0);
    let confidence = (0.5 + (best - runner_up).max(0.0)).clamp(0.0, 1.0);
    (source_index as u16, confidence)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ties_use_stable_source_order_and_invalid_is_unresolved() {
        let candidate = |source_index| Candidate {
            alignment_confidence: 1.0,
            clipped: false,
            is_reference: false,
            source_index,
            valid: true,
            value: 0.5,
        };
        assert_eq!(select(&[candidate(2), candidate(0)]).0, 0);
        assert_eq!(select(&[]).0, UNRESOLVED_OWNER);
    }
}
