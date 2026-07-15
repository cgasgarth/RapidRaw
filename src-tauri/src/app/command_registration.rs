use tauri::ipc::Invoke;

#[cfg(feature = "ai")]
use crate::ai::ai_commands as build_ai_commands;
#[cfg(not(feature = "ai"))]
use crate::app::disabled_commands as build_ai_commands;

macro_rules! define_command_registry {
    ($( $(#[$meta:meta])* $command:path),* $(,)?) => {
        pub(crate) fn invoke_handler() -> impl Fn(Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
            debug_assert!(registry_is_unique());
            tauri::generate_handler![$($(#[$meta])* $command),*]
        }

        pub(crate) const fn registered_command_paths() -> &'static [&'static str] {
            &[$($(#[$meta])* stringify!($command)),*]
        }
    };
}

define_command_registry![
    crate::app::commands::preview::apply_adjustments,
    crate::app::commands::soft_proof_preview::generate_export_soft_proof_preview,
    crate::app::commands::soft_proof_preview::resolve_export_soft_proof_transform_metadata,
    crate::app::commands::path_preview::generate_preview_for_path,
    crate::app::commands::negative_lab_dust::analyze_negative_lab_dust_spots,
    crate::app::commands::original_preview::generate_original_transformed_preview,
    crate::app::commands::viewer_sampling::sample_viewer_pixel,
    crate::app::commands::preset_previews::generate_preset_preview,
    crate::app::commands::uncropped_preview::generate_uncropped_preview,
    crate::editor::preview_geometry::preview_geometry_transform,
    crate::app::commands::logging::get_log_file_path,
    crate::app::commands::logging::frontend_log,
    crate::app::commands::collage::save_collage,
    crate::merge::hdr::runtime_commands::merge_hdr,
    crate::merge::hdr::commands::cancel_hdr_plan,
    crate::merge::focus_stack::commands::plan_focus_stack,
    crate::merge::focus_stack::commands::cancel_focus_stack_plan,
    crate::merge::focus_stack::job::prepare_focus_stack_candidate,
    crate::merge::focus_stack::job::read_focus_stack_job,
    crate::merge::focus_stack::apply::apply_focus_stack_candidate,
    crate::merge::focus_stack::retouch::apply_focus_stack_retouch,
    crate::merge::focus_stack::retouch::open_focus_stack_retouch,
    crate::merge::focus_stack::retouch::navigate_focus_stack_retouch,
    crate::merge::hdr::runtime_commands::save_hdr,
    crate::app::commands::lut::load_and_parse_lut,
    crate::app::commands::community_presets::fetch_community_presets,
    crate::app::commands::preset_previews::generate_all_community_previews,
    crate::app::commands::temporary_artifacts::save_temp_file,
    crate::app::commands::source::get_image_dimensions,
    crate::app::commands::perspective::analyze_perspective_correction,
    crate::app::commands::source::is_original_file_available,
    crate::app::commands::source::resolve_original_source_identity,
    crate::app::commands::startup::frontend_ready,
    crate::app::commands::startup::get_startup_trace,
    crate::app::commands::startup::record_frontend_startup_phase,
    crate::library::changefeed::configure_library_changefeed,
    crate::library::changefeed::get_library_changefeed_report,
    crate::library::file_management::get_library_change_rows,
    crate::library::catalog::open_library_collection,
    crate::library::catalog::next_library_collection_page,
    crate::library::catalog::reconcile_library_catalog,
    crate::library::catalog::apply_library_catalog_changes,
    crate::library::catalog::get_library_catalog_report,
    crate::library::catalog::get_library_folder_aggregates,
    crate::app::commands::thumbnail::cancel_thumbnail_generation,
    crate::app::commands::wgpu_presentation::update_wgpu_transform,
    crate::app::commands::wgpu_presentation::flush_wgpu_presentation,
    crate::app::commands::wgpu_presentation::get_wgpu_presentation_report,
    crate::editor::picker_commands::analyze_tone_equalizer_placement,
    crate::editor::picker_commands::sample_tone_equalizer_picker,
    crate::editor::picker_commands::sample_point_color_picker,
    crate::app::display_target::get_display_target_report,
    crate::app::commands::wgpu_presentation::get_gpu_pipeline_report,
    crate::android_integration::resolve_android_content_uri_name,
    crate::cache_utils::clear_session_caches,
    crate::cache_utils::clear_image_caches,
    crate::app_settings::load_settings,
    crate::app_settings::save_settings,
    crate::app::capabilities::get_native_capabilities,
    build_ai_commands::generate_ai_subject_mask,
    build_ai_commands::generate_ai_object_mask_proposal,
    build_ai_commands::precompute_ai_subject_mask,
    build_ai_commands::generate_ai_foreground_mask,
    build_ai_commands::generate_ai_sky_mask,
    build_ai_commands::generate_ai_depth_mask,
    build_ai_commands::generate_ai_whole_person_mask,
    build_ai_commands::generate_ai_person_part_mask,
    build_ai_commands::get_ai_model_registry_report,
    build_ai_commands::cancel_ai_model_load,
    build_ai_commands::evict_ai_model_session,
    build_ai_commands::check_ai_connector_status,
    build_ai_commands::test_ai_connector_connection,
    build_ai_commands::invoke_generative_replace_with_mask_def,
    crate::denoise_api::dry_run_denoise_controls,
    crate::denoising::apply_denoising,
    crate::denoising::execute_denoising,
    crate::denoising::cancel_denoising,
    crate::denoising::batch_denoise_images,
    crate::denoising::save_denoised_image,
    crate::app::commands::display_profile::get_active_display_profile,
    crate::app::commands::display_profile::get_display_preview_lut_status,
    crate::color::camera_profile::registry::list_camera_profiles,
    crate::color::camera_profile::registry::import_camera_profile,
    crate::color::camera_profile::registry::remove_camera_profile,
    crate::color::camera_profile::registry::reveal_camera_profile,
    crate::color::calibration::fit_and_publish_chart_calibration,
    crate::color::calibration::fit_chart_calibration_report,
    crate::color::calibration::list_supported_chart_definitions,
    crate::color::calibration::validate_chart_capture_geometry,
    crate::image_loader::compare_raw_reconstruction_modes,
    crate::image_loader::load_image,
    crate::image_open_session::begin_image_open,
    crate::image_open_session::schedule_image_prefetch,
    crate::image_open_session::get_image_open_diagnostics,
    crate::image_loader::is_image_cached,
    crate::merge::hdr::commands::plan_hdr,
    crate::super_resolution::plan_super_resolution,
    crate::super_resolution::cancel_super_resolution_registration,
    crate::super_resolution::job::prepare_burst_sr_candidate,
    crate::super_resolution::job::read_burst_sr_candidate_job,
    crate::super_resolution::apply::apply_burst_sr_candidate,
    crate::super_resolution::single_image::get_single_image_x2_capability,
    crate::super_resolution::single_image::preview_single_image_x2,
    crate::super_resolution::single_image::apply::apply_single_image_x2,
    crate::super_resolution::single_image::batch::queue_single_image_x2_batch,
    crate::super_resolution::single_image::cancel_single_image_x2_preview,
    crate::merge::computational_job::cancel_computational_merge_job,
    crate::panorama_stitching::plan_panorama,
    crate::panorama_stitching::cancel_panorama_alignment,
    crate::panorama_stitching::stitch_panorama,
    crate::panorama_stitching::save_panorama,
    crate::export::export_processing::get_export_color_capabilities,
    crate::export::export_processing::get_hdr_export_capabilities,
    crate::export::export_processing::export_images,
    crate::export::export_processing::resume_export,
    crate::export::export_processing::cancel_export,
    crate::export::export_processing::estimate_export_sizes,
    crate::auto_adjust::calculate_auto_adjustments,
    crate::auto_adjust::calculate_legacy_auto_adjustments_v1,
    crate::color::auto_edit::analyze_auto_edit,
    crate::color::auto_edit::preview_auto_edit_proposal,
    crate::color::auto_edit::apply_auto_edit_proposal,
    crate::color::auto_edit::cancel_auto_edit_analysis,
    crate::mask_generation::generate_mask_overlay,
    crate::file_management::update_exif_fields,
    crate::file_management::get_supported_file_types,
    crate::file_management::read_exif_for_paths,
    crate::file_management::check_xmp_metadata_conflicts,
    crate::file_management::read_library_relink_identity,
    crate::file_management::list_images_in_dir,
    crate::file_management::list_images_recursive,
    crate::file_management::get_folder_tree,
    crate::file_management::get_folder_children,
    crate::file_management::get_folder_refresh_snapshot,
    crate::file_management::get_pinned_folder_trees,
    crate::file_management::update_thumbnail_queue,
    crate::thumbnail_resources::get_thumbnail_resource,
    crate::thumbnail_resources::get_thumbnail_transport_metrics,
    crate::file_management::create_folder,
    crate::file_management::delete_folder,
    crate::file_management::copy_files,
    crate::file_management::move_files,
    crate::file_management::rename_folder,
    crate::file_management::rename_files,
    crate::file_management::duplicate_file,
    crate::file_management::show_in_finder,
    crate::file_management::delete_files_from_disk,
    crate::file_management::delete_files_with_associated,
    crate::file_management::save_metadata_and_update_thumbnail,
    crate::file_management::import_external_editor_variant,
    crate::file_management::get_external_editor_file_watch_snapshot,
    crate::file_management::launch_external_editor,
    crate::file_management::apply_adjustments_to_paths,
    crate::file_management::load_metadata,
    crate::presets::load_presets,
    crate::presets::save_presets,
    crate::file_management::get_or_create_internal_library_root,
    crate::file_management::reset_adjustments_for_paths,
    crate::file_management::apply_auto_adjustments_to_paths,
    crate::file_management::commit_batch_auto_adjustment,
    crate::presets::handle_import_presets_from_file,
    crate::presets::handle_import_legacy_presets_from_file,
    crate::presets::handle_export_presets_to_file,
    crate::presets::save_community_preset,
    crate::file_management::clear_all_sidecars,
    #[cfg(feature = "validation-harness")]
    crate::color_gpu_readback_probe::run_color_gpu_readback_probe,
    #[cfg(feature = "validation-harness")]
    crate::raw_open_edit_export_proof::run_raw_open_edit_export_proof,
    crate::file_management::clear_thumbnail_cache,
    crate::file_management::set_color_label_for_paths,
    crate::file_management::set_rating_for_paths,
    crate::file_management::resolve_xmp_metadata_conflicts,
    crate::file_management::import_files,
    crate::file_management::cancel_import,
    crate::file_management::get_active_import_job_status,
    crate::file_management::get_import_job_receipt,
    crate::file_management::validate_import_job_resume,
    crate::file_management::resume_import_job,
    crate::file_management::create_virtual_copy,
    crate::album_management::get_albums,
    crate::album_management::save_albums,
    crate::album_management::add_to_album,
    crate::file_management::get_album_images,
    crate::tagging::indexing::start_background_indexing,
    crate::tagging::indexing::cancel_background_indexing,
    crate::tagging::clear_ai_tags,
    crate::tagging::clear_all_tags,
    crate::tagging::add_tag_for_paths,
    crate::tagging::remove_tag_for_paths,
    crate::culling::cull_images,
    crate::tethering::discover_tethered_cameras,
    crate::tethering::open_tether_session,
    crate::tethering::get_tether_session,
    crate::tethering::close_tether_session,
    crate::tethering::set_tether_camera_control,
    crate::tethering::trigger_tether_capture,
    crate::deblur_api::dry_run_deblur_controls,
    crate::lens_correction::get_lensfun_makers,
    crate::lens_correction::get_lensfun_lenses_for_maker,
    crate::lens_correction::autodetect_lens,
    crate::lens_correction::get_lens_distortion_params,
    crate::negative_conversion::preview_negative_conversion,
    crate::negative_conversion::preflight_negative_lab_source,
    crate::negative_conversion::fit_negative_lab_measured_profile,
    crate::negative_conversion::lock_negative_lab_roll_bounds,
    crate::negative_conversion::render_negative_lab_dry_run_preview_artifact,
    crate::negative_conversion::estimate_negative_base_fog,
    crate::negative_conversion::suggest_negative_lab_neutral_patch_rgb_balance,
    crate::negative_conversion::suggest_negative_lab_highlight_patch_exposure,
    crate::negative_conversion::suggest_negative_lab_shadow_patch_black_point,
    crate::negative_conversion::convert_negatives,
    crate::negative_lab_profiles::read_negative_lab_measured_profile_library,
    crate::negative_lab_profiles::write_negative_lab_measured_profile_library,
];

pub(crate) fn registered_command_names() -> Vec<&'static str> {
    registered_command_paths()
        .iter()
        .map(|path| path.rsplit("::").next().unwrap_or(path))
        .collect()
}

fn registry_is_unique() -> bool {
    let names = registered_command_names();
    names.len()
        == names
            .iter()
            .copied()
            .collect::<std::collections::HashSet<_>>()
            .len()
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    #[test]
    fn production_registry_has_unique_commands() {
        assert!(registry_is_unique());
    }

    #[test]
    #[ignore = "executed by typed frontend/native command parity validation"]
    fn frontend_registry_matches_typed_invokes() {
        let frontend = serde_json::from_str::<Vec<String>>(
            &std::env::var("RAWENGINE_FRONTEND_INVOKES").expect("typed frontend invokes"),
        )
        .expect("valid typed frontend invoke JSON")
        .into_iter()
        .collect::<HashSet<_>>();
        let native = registered_command_names()
            .into_iter()
            .map(str::to_string)
            .collect::<HashSet<_>>();
        assert_eq!(native, frontend);
    }
}
