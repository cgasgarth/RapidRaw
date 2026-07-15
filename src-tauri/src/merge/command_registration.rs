macro_rules! with_commands {
    ($callback:ident [$($entries:tt)*]) => {
        $callback!([
            $($entries)*
            ("computational", crate::merge::hdr::runtime_commands::merge_hdr),
            ("computational", crate::merge::hdr::commands::cancel_hdr_plan),
            ("computational", crate::merge::focus_stack::commands::plan_focus_stack),
            ("computational", crate::merge::focus_stack::commands::cancel_focus_stack_plan),
            ("computational", crate::merge::focus_stack::job::prepare_focus_stack_candidate),
            ("computational", crate::merge::focus_stack::job::read_focus_stack_job),
            ("computational", crate::merge::focus_stack::apply::apply_focus_stack_candidate),
            ("computational", crate::merge::focus_stack::retouch::apply_focus_stack_retouch),
            ("computational", crate::merge::focus_stack::retouch::open_focus_stack_retouch),
            ("computational", crate::merge::focus_stack::retouch::navigate_focus_stack_retouch),
            ("computational", crate::merge::hdr::runtime_commands::save_hdr),
            ("computational", crate::merge::hdr::commands::plan_hdr),
            ("computational", crate::super_resolution::plan_super_resolution),
            ("computational", crate::super_resolution::cancel_super_resolution_registration),
            ("computational", crate::super_resolution::job::prepare_burst_sr_candidate),
            ("computational", crate::super_resolution::job::read_burst_sr_candidate_job),
            ("computational", crate::super_resolution::apply::apply_burst_sr_candidate),
            ("computational", crate::super_resolution::single_image::get_single_image_x2_capability),
            ("computational", crate::super_resolution::single_image::preview_single_image_x2),
            ("computational", crate::super_resolution::single_image::apply::apply_single_image_x2),
            ("computational", crate::super_resolution::single_image::batch::queue_single_image_x2_batch),
            ("computational", crate::super_resolution::single_image::cancel_single_image_x2_preview),
            ("computational", crate::merge::computational_job::cancel_computational_merge_job),
            ("computational", crate::panorama_stitching::plan_panorama),
            ("computational", crate::panorama_stitching::cancel_panorama_alignment),
            ("computational", crate::panorama_stitching::stitch_panorama),
            ("computational", crate::panorama_stitching::save_panorama),
        ]);
    };
}

pub(crate) use with_commands;
