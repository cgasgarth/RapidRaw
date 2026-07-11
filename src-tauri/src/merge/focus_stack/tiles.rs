use crate::merge::tile_runtime::{AcceptedTilePlan, TileHalo, TilePlanRequest, plan_tiles};

pub(crate) const DEFAULT_CORE: u32 = 1024;
pub(crate) const LABEL_RADIUS: u32 = 2;
pub(crate) const LABEL_SWEEPS: u32 = 4;
pub(crate) const PYRAMID_LEVELS: u32 = 6;
pub(crate) const PYRAMID_KERNEL_RADIUS: u32 = 2;

/// A dependency can move LABEL_RADIUS pixels per refinement sweep. Each
/// pyramid level doubles the support of the 5-tap binomial kernel.
pub(crate) fn influence_halo() -> u32 {
    LABEL_RADIUS * LABEL_SWEEPS + PYRAMID_KERNEL_RADIUS * ((1 << PYRAMID_LEVELS) - 1)
}

pub(crate) fn plan(
    width: u32,
    height: u32,
    source_count: usize,
    memory_budget_bytes: u64,
    requested_core: u32,
) -> Result<AcceptedTilePlan, String> {
    let halo = influence_halo();
    let mut accepted = plan_tiles(TilePlanRequest {
        schema_version: 1,
        output_width: u64::from(width),
        output_height: u64::from(height),
        // RGB source, response, interpolation and pyramid scratch are explicit.
        bytes_per_working_pixel: 3 * 4 + 4 + 3 * 4,
        source_count: source_count as u64,
        requested_core_width: requested_core,
        requested_core_height: requested_core,
        halo: TileHalo {
            top: halo,
            right: halo,
            bottom: halo,
            left: halo,
        },
        memory_budget_bytes: Some(memory_budget_bytes),
    })?;
    accepted.stage_work_units =
        super::job::stage_work_units(accepted.tile_count, source_count as u64);
    Ok(accepted)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn focus_plan_is_multi_tile_and_reserves_safety_margin() {
        let plan = plan(4096, 3072, 3, 256 * 1024 * 1024, 1024).unwrap();
        assert!(plan.tile_count > 1);
        assert!(plan.memory.safety_margin_bytes * 100 >= plan.memory.subtotal_bytes * 15);
        assert_eq!(plan.halo.left, influence_halo());
    }
}
