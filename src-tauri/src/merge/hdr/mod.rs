pub(crate) mod alignment;
pub(crate) mod commands;
pub(crate) mod deghost;
pub(crate) mod full_resolution;
pub(crate) mod motion;
pub(crate) mod planning_service;
pub(crate) mod radiance;
pub(crate) mod runtime;
pub(crate) mod runtime_commands;
pub(crate) mod source_frame;
pub(crate) mod source_ownership;
pub(crate) mod static_merge;
pub(crate) mod tone_map;

mod plan;

pub(crate) use alignment::ALIGNMENT_POLICY_ID;
pub(crate) use plan::PlannedSource;
pub(crate) use plan::{HdrAlignmentPlanResponse, build_alignment_plan};

#[cfg(test)]
mod derived_output_tests {
    use super::full_resolution::build_tile_plan;

    #[test]
    fn derived_output_uses_multitile_plan() {
        let plan = build_tile_plan(6048, 4024, 3).unwrap();
        assert!(plan.tile_count > 1);
        assert_eq!(plan.overlap_ownership, "core_only");
    }
}
