macro_rules! with_commands {
    ($callback:ident [$($entries:tt)*]) => {
        $callback!([
            $($entries)*
            ("export", crate::export::export_processing::get_export_color_capabilities),
            ("export", crate::export::export_processing::get_hdr_export_capabilities),
            ("export", crate::export::export_processing::export_images),
            ("export", crate::export::export_processing::resume_export),
            ("export", crate::export::export_processing::cancel_export),
            ("export", crate::export::export_processing::estimate_export_sizes),
        ]);
    };
}

pub(crate) use with_commands;
