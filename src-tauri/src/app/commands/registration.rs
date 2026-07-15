#[cfg(feature = "ai")]
pub(crate) use crate::ai::ai_commands as build_ai_commands;
#[cfg(not(feature = "ai"))]
pub(crate) use crate::app::disabled_commands as build_ai_commands;

macro_rules! with_commands {
    ($callback:ident [$($entries:tt)*]) => {
        $callback!([
            $($entries)*
            ("application", crate::app::commands::preview::apply_adjustments),
            ("application", crate::app::commands::soft_proof_preview::generate_export_soft_proof_preview),
            ("application", crate::app::commands::soft_proof_preview::resolve_export_soft_proof_transform_metadata),
            ("application", crate::app::commands::path_preview::generate_preview_for_path),
            ("application", crate::app::commands::negative_lab_dust::analyze_negative_lab_dust_spots),
            ("application", crate::app::commands::original_preview::generate_original_transformed_preview),
            ("application", crate::app::commands::viewer_sampling::sample_viewer_pixel),
            ("application", crate::app::commands::preset_previews::generate_preset_preview),
            ("application", crate::app::commands::film_thumbnails::render_film_profile_thumbnail),
            ("application", crate::app::commands::film_thumbnails::cancel_film_profile_thumbnail),
            ("application", crate::app::commands::film_thumbnails::release_film_profile_thumbnail),
            ("application", crate::app::commands::film_thumbnails::handle_film_thumbnail_memory_pressure),
            ("application", crate::app::commands::uncropped_preview::generate_uncropped_preview),
            ("application", crate::app::commands::logging::get_log_file_path),
            ("application", crate::app::commands::logging::frontend_log),
            ("application", crate::app::commands::collage::save_collage),
            ("application", crate::app::commands::lut::load_and_parse_lut),
            ("application", crate::app::commands::community_presets::fetch_community_presets),
            ("application", crate::app::commands::preset_previews::generate_all_community_previews),
            ("application", crate::app::commands::temporary_artifacts::save_temp_file),
            ("application", crate::app::commands::source::get_image_dimensions),
            ("application", crate::app::commands::perspective::analyze_perspective_correction),
            ("application", crate::app::commands::source::is_original_file_available),
            ("application", crate::app::commands::source::resolve_original_source_identity),
            ("startup", crate::app::commands::startup::frontend_ready),
            ("startup", crate::app::commands::startup::get_startup_trace),
            ("startup", crate::app::commands::startup::record_frontend_startup_phase),
            ("application", crate::app::commands::thumbnail::cancel_thumbnail_generation),
            ("application", crate::app::commands::wgpu_presentation::update_wgpu_transform),
            ("application", crate::app::commands::wgpu_presentation::flush_wgpu_presentation),
            ("application", crate::app::commands::wgpu_presentation::get_wgpu_presentation_report),
            ("application", crate::app::display_target::get_display_target_report),
            ("application", crate::app::commands::wgpu_presentation::get_gpu_pipeline_report),
            ("application", crate::android_integration::resolve_android_content_uri_name),
            ("application", crate::cache_utils::clear_session_caches),
            ("application", crate::cache_utils::clear_image_caches),
            ("application", crate::app_settings::load_settings),
            ("application", crate::app_settings::save_settings),
            ("application", crate::app::capabilities::get_native_capabilities),
            ("application", crate::app::commands::registration::build_ai_commands::generate_ai_subject_mask),
            ("application", crate::app::commands::registration::build_ai_commands::generate_ai_object_mask_proposal),
            ("application", crate::app::commands::registration::build_ai_commands::precompute_ai_subject_mask),
            ("application", crate::app::commands::registration::build_ai_commands::generate_ai_foreground_mask),
            ("application", crate::app::commands::registration::build_ai_commands::generate_ai_sky_mask),
            ("application", crate::app::commands::registration::build_ai_commands::generate_ai_depth_mask),
            ("application", crate::app::commands::registration::build_ai_commands::generate_ai_whole_person_mask),
            ("application", crate::app::commands::registration::build_ai_commands::generate_ai_person_part_mask),
            ("application", crate::app::commands::registration::build_ai_commands::get_ai_model_registry_report),
            ("application", crate::app::commands::registration::build_ai_commands::cancel_ai_model_load),
            ("application", crate::app::commands::registration::build_ai_commands::evict_ai_model_session),
            ("application", crate::app::commands::registration::build_ai_commands::check_ai_connector_status),
            ("application", crate::app::commands::registration::build_ai_commands::test_ai_connector_connection),
            ("application", crate::app::commands::registration::build_ai_commands::invoke_generative_replace_with_mask_def),
            ("application", crate::app::commands::display_profile::get_active_display_profile),
            ("application", crate::app::commands::display_profile::get_display_preview_lut_status),
        ]);
    };
}

pub(crate) use with_commands;
