macro_rules! with_commands {
    ($callback:ident [$($entries:tt)*]) => {
        $callback!([
            $($entries)*
            ("computational", crate::computational::commands::cancellation::cancel_hdr_plan),
            ("computational", crate::computational::commands::cancellation::cancel_focus_stack_plan),
            ("computational", crate::computational::commands::cancellation::cancel_super_resolution_registration),
            ("computational", crate::computational::commands::cancellation::cancel_panorama_alignment),
            ("computational", crate::computational::commands::cancellation::cancel_computational_merge_job),
        ]);
    };
}

pub(crate) use with_commands;
