use crate::merge::tile_runtime::{AcceptedTilePlan, TileHalo, TilePlanRequest, plan_tiles};

pub(crate) const DEFAULT_CORE: u32 = 512;
pub(crate) const RECONSTRUCTION_RADIUS: u32 = 7;
pub(crate) const MOTION_BLOCK: u32 = 16;
pub(crate) const MOTION_DILATION: u32 = 2;
pub(crate) const FALLBACK_TRANSITION: u32 = 2;
pub(crate) const SHARPEN_RADIUS: u32 = 1;

pub(crate) fn influence_halo() -> u32 {
    RECONSTRUCTION_RADIUS + MOTION_BLOCK + MOTION_DILATION + FALLBACK_TRANSITION + SHARPEN_RADIUS
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
        // One source CFA tile plus four estimates, RGB/baseline, maps and robust scratch.
        bytes_per_working_pixel: 8 + 4 * 24 + 3 * 12 + 24,
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
    })
    .map_err(|error| {
        if error.contains("memory_budget") {
            "memory_budget_too_small".into()
        } else {
            error
        }
    })?;
    accepted.stage_work_units =
        super::job::stage_work_units(accepted.tile_count, source_count as u64);
    Ok(accepted)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_is_multi_tile_and_reserves_support() {
        let plan = plan(8000, 6000, 4, 512 * 1024 * 1024, 512).unwrap();
        assert!(plan.tile_count > 1);
        assert_eq!(plan.halo.left, influence_halo());
        assert!(plan.memory.safety_margin_bytes * 100 >= plan.memory.subtotal_bytes * 15);
    }
}
