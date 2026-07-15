#![cfg_attr(not(feature = "ai"), allow(dead_code))]

#[cfg(not(all(target_os = "windows", target_arch = "aarch64")))]
use mimalloc::MiMalloc;

#[cfg(not(all(target_os = "windows", target_arch = "aarch64")))]
#[global_allocator]
static GLOBAL: MiMalloc = MiMalloc;

mod adjustments;
mod ai;
mod album_management;
mod android_integration;
mod app;
mod app_settings;
mod app_state;
mod color;
mod community_presets;
mod computational;
mod detail;
mod editor;
mod events;
mod export;
mod geometry;
mod gpu;
mod io;
mod layers;
mod library;
mod merge;
mod negative_lab_profiles;
mod preset_converter;
mod presets;
mod proofs;
#[cfg(all(feature = "validation-harness", unix))]
mod qa_control;
mod raw;
mod render;
mod tagging;
pub mod tone;
#[cfg(test)]
mod validation;
mod window_customizer;

pub(crate) use color::*;
pub use community_presets::CommunityPreset;
pub(crate) use computational::*;
pub use computational::{deblur_cpu_reference, denoise_cpu_reference};
pub(crate) use gpu::*;
pub(crate) use io::*;
pub(crate) use library::*;
pub(crate) use merge::*;
pub(crate) use raw::*;
pub use render::resample::{
    AxisPlan, AxisSpan, CancellationProbe, ResampleCacheMetrics, ResampleError, ResampleKey,
    ResamplePlan, ResampledImage, cache_metrics as resample_cache_metrics, downscale_f32_image_cow,
};
pub(crate) use render::*;

use std::fs;
use std::io::Cursor;
use std::panic;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{Emitter, Manager};

#[cfg(feature = "ai")]
use crate::ai::ai_commands as build_ai_commands;
#[cfg(not(feature = "ai"))]
use crate::app::disabled_commands as build_ai_commands;
use crate::image_codecs::encode_jpeg_response;

use crate::app::startup::NativeStartupPhase;
#[cfg(test)]
use crate::cache_utils::calculate_geometry_hash;
use crate::cache_utils::{calculate_transform_hash, calculate_visual_hash};
use crate::editor::preview_geometry::preview_geometry_transform;
use crate::file_management::parse_virtual_path;
use crate::film_look_render::normalize_film_look_adjustments_for_render;
use crate::formats::is_raw_file;
use crate::image_processing::{
    Crop, RenderRequest, apply_srgb_to_linear, downscale_f32_image, get_or_init_gpu_context,
    process_and_get_dynamic_image, resolve_tonemapper_override_from_handle,
};
use crate::lut_processing::Lut;
use crate::mask_generation::{
    MaskDefinition, generate_mask_bitmap, get_cached_or_generate_mask,
    resolve_warped_image_for_masks,
};
use crate::window_customizer::PinchZoomDisablePlugin;
pub use adjustment_utils::*;
pub use android_integration::*;
pub use app_settings::*;
pub use app_state::*;

#[cfg(target_os = "macos")]
extern "C" fn force_exit(_signal: libc::c_int) {
    unsafe {
        libc::_exit(0);
    }
}

#[cfg(target_os = "macos")]
pub fn register_exit_handler() {
    unsafe {
        libc::signal(libc::SIGABRT, force_exit as *const () as libc::sighandler_t);
    }
}

#[cfg(not(target_os = "macos"))]
pub fn register_exit_handler() {}

#[derive(Serialize)]
struct LutParseResult {
    size: u32,
}

#[derive(serde::Serialize)]
struct ImageDimensions {
    width: u32,
    height: u32,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WgpuTransformPayload {
    pub window_width: f32,
    pub window_height: f32,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub clip_x: f32,
    pub clip_y: f32,
    pub clip_width: f32,
    pub clip_height: f32,
    pub bg_primary: [f32; 4],
    pub bg_secondary: [f32; 4],
    pub pixelated: bool,
}

pub use editor::preview_geometry_service::{
    PreviewGeometryPipeline, PreviewGeometryReceipt, PreviewGeometryRequest, PreviewGeometryResult,
    PreviewGeometryService,
};
pub(crate) use editor::preview_geometry_service::{
    generate_transformed_preview, generate_transformed_preview_cancellable,
};

pub fn get_or_load_lut(state: &AppState, path: &str) -> Result<Arc<Lut>, String> {
    let fingerprint = lut_processing::source_fingerprint(path).map_err(|e| e.to_string())?;
    if let Some(entry) = state.lut_cache.get(&path.to_string())
        && entry.fingerprint == fingerprint
    {
        return Ok(Arc::clone(&entry.lut));
    }

    let parsed = lut_processing::parse_lut_file(path).map_err(|e| e.to_string())?;
    let content_hash = parsed.content_hash;
    let arc_lut = state
        .lut_content_cache
        .get(&content_hash)
        .unwrap_or_else(|| {
            let lut = Arc::new(parsed);
            state
                .lut_content_cache
                .insert(content_hash, Arc::clone(&lut), lut.retained_bytes());
            lut
        });
    state.lut_cache.insert(
        path.to_string(),
        Arc::new(crate::lut_processing::CachedLutPath {
            fingerprint,
            lut: Arc::clone(&arc_lut),
        }),
        256,
    );
    Ok(arc_lut)
}

fn setup_logging(app_handle: &tauri::AppHandle) {
    let log_dir = match app_handle.path().app_log_dir() {
        Ok(dir) => dir,
        Err(e) => {
            eprintln!("Failed to get app log directory: {}", e);
            return;
        }
    };

    if let Err(e) = fs::create_dir_all(&log_dir) {
        eprintln!("Failed to create log directory at {:?}: {}", log_dir, e);
    }

    let log_file_path = log_dir.join("app.log");

    let log_file = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&log_file_path)
        .ok();

    let var = std::env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string());
    let level: log::LevelFilter = var.parse().unwrap_or(log::LevelFilter::Info);

    let mut dispatch = fern::Dispatch::new()
        .format(|out, message, record| {
            out.finish(format_args!(
                "{} [{}] {}",
                chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
                record.level(),
                message
            ))
        })
        .level(level)
        .chain(std::io::stderr());

    if let Some(file) = log_file {
        dispatch = dispatch.chain(file);
    } else {
        eprintln!(
            "Failed to open log file at {:?}. Logging to console only.",
            log_file_path
        );
    }

    if let Err(e) = dispatch.apply() {
        eprintln!("Failed to apply logger configuration: {}", e);
    }

    panic::set_hook(Box::new(|info| {
        let message = if let Some(s) = info.payload().downcast_ref::<&'static str>() {
            s.to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            format!("{:?}", info.payload())
        };
        let location = info.location().map_or_else(
            || "at an unknown location".to_string(),
            |loc| format!("at {}:{}:{}", loc.file(), loc.line(), loc.column()),
        );
        log::error!("PANIC! {} - {}", location, message.trim());
    }));

    log::info!(
        "Logger initialized successfully. Log file at: {:?}",
        log_file_path
    );
}

#[cfg(not(target_os = "android"))]
fn restore_window_state(window: &tauri::WebviewWindow, state: &WindowState) {
    const MIN_WINDOW_WIDTH: u32 = 800;
    const MIN_WINDOW_HEIGHT: u32 = 600;
    const DEFAULT_WINDOW_WIDTH: u32 = 1280;
    const DEFAULT_WINDOW_HEIGHT: u32 = 720;
    let Some(monitor) = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())
        .or_else(|| {
            window
                .available_monitors()
                .ok()
                .and_then(|m| m.into_iter().next())
        })
    else {
        let _ = window.center();
        return;
    };

    let work_area = monitor.work_area();
    let work_area_size = work_area.size;
    let work_area_position = work_area.position;
    let max_width = work_area_size.width.max(1);
    let max_height = work_area_size.height.max(1);

    let requested_width = if state.width >= MIN_WINDOW_WIDTH {
        state.width
    } else {
        DEFAULT_WINDOW_WIDTH
    };
    let requested_height = if state.height >= MIN_WINDOW_HEIGHT {
        state.height
    } else {
        DEFAULT_WINDOW_HEIGHT
    };

    let width = requested_width
        .min(max_width)
        .max(MIN_WINDOW_WIDTH.min(max_width));
    let height = requested_height
        .min(max_height)
        .max(MIN_WINDOW_HEIGHT.min(max_height));
    let max_x = work_area_position.x + work_area_size.width as i32 - width as i32;
    let max_y = work_area_position.y + work_area_size.height as i32 - height as i32;
    let x = state
        .x
        .clamp(work_area_position.x, max_x.max(work_area_position.x));
    let y = state
        .y
        .clamp(work_area_position.y, max_y.max(work_area_position.y));

    let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(
        width, height,
    )));
    let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
        x, y,
    )));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg_attr(feature = "validation-harness", allow(unused_mut))]
    let mut builder = tauri::Builder::default();

    #[cfg(all(feature = "validation-harness", unix))]
    {
        builder = builder.manage(qa_control::QaControlState::from_environment());
    }

    #[cfg(all(
        not(any(target_os = "android", target_os = "ios")),
        not(feature = "validation-harness")
    ))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            log::info!(
                "New instance launched with args: {:?}. Focusing main window.",
                argv
            );
            if let Some(window) = app.get_webview_window("main") {
                if let Err(e) = window.unminimize() {
                    log::error!("Failed to unminimize window: {}", e);
                }
                if let Err(e) = window.set_focus() {
                    log::error!("Failed to set focus on window: {}", e);
                }
            }

            if argv.len() > 1 {
                crate::app::commands::startup::publish_file_open(app, argv[1].clone());
            }
        }));
    }

    builder
        .register_uri_scheme_protocol(thumbnail_resources::THUMBNAIL_PROTOCOL, |context, request| {
            thumbnail_resources::protocol_response(context.app_handle(), request.uri())
        })
        .register_uri_scheme_protocol(analytics_resources::ANALYTICS_PROTOCOL, |_context, request| {
            analytics_resources::protocol_response(request.uri())
        })
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(PinchZoomDisablePlugin)
        .on_window_event(|window, event| if let tauri::WindowEvent::Resized(size) = event {
            let state = window.state::<AppState>();
            if let Some(ctx) = state.gpu_context.lock().unwrap().as_ref() {
                ctx.presentation.resize(size.width, size.height);
            }
            #[cfg(target_os = "macos")]
            crate::app::display_target::request_for_state(&state);
        } else if let tauri::WindowEvent::Moved(_) = event {
            #[cfg(target_os = "macos")]
            {
                let state = window.state::<AppState>();
                crate::app::display_target::request_for_state(&state);
            }
        } else if let tauri::WindowEvent::Focused(true) = event {
            #[cfg(target_os = "macos")]
            {
                let state = window.state::<AppState>();
                crate::app::display_target::request_for_state(&state);
            }
        })
        .setup(|app| {
            #[cfg(any(windows, target_os = "linux"))]
            {
                if let Some(arg) = std::env::args().nth(1) {
                    log::info!("Windows/Linux initial open: Storing path {} for later.", &arg);
                    crate::app::commands::startup::publish_file_open(app.handle(), arg);
                }
            }

            let app_handle = app.handle().clone();
            if let Err(error) = color::camera_profile::registry::managed_profile_root(&app_handle) {
                log::warn!("camera_profile_registry_root_unavailable: {error}");
            }
            app.state::<AppState>()
                .startup_trace
                .mark(NativeStartupPhase::ProcessStarted, "ok", None);
            let config_dir = app_handle.path().app_config_dir().expect("Failed to get config dir");
            let crash_flag_path = config_dir.join(".gpu_init_crash_flag");

            {
                let state = app.state::<AppState>();
                state
                    .services
                    .gpu_crash_marker
                    .configure(crash_flag_path.clone());
            }

            let mut settings: AppSettings = load_settings_or_default(&app_handle);
            app.state::<AppState>().startup_trace.mark(
                NativeStartupPhase::MinimalSettingsLoaded,
                "ok",
                None,
            );

            {
                let state = app.state::<AppState>();
                let cache_size = settings.image_cache_size.unwrap_or(5) as usize;
                render_caches::RenderCaches::new(&state).set_decoded_image_cache_capacity(cache_size);
            }

            if crash_flag_path.exists() {
                log::warn!("GPU Driver crash detected on last run! Falling back to OpenGL backend.");
                settings.processing_backend = Some("gl".to_string());
                let _ = crate::save_settings(settings.clone(), app_handle.clone());
                let _ = std::fs::remove_file(&crash_flag_path);
            }

            unsafe {
                if let Some(backend) = &settings.processing_backend
                    && backend != "auto" {
                        std::env::set_var("WGPU_BACKEND", backend);
                    }

                if settings.linux_gpu_optimization.unwrap_or(true) {
                    #[cfg(target_os = "linux")]
                    {
                        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
                        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
                        std::env::set_var("NODEVICE_SELECT", "1");
                    }
                }

                #[cfg(not(target_os = "android"))]
                {
                    let resource_path = app_handle
                        .path()
                        .resolve("resources", tauri::path::BaseDirectory::Resource)
                        .expect("failed to resolve resource directory");

                    let ort_library_name = {
                        #[cfg(target_os = "windows")]
                        { "onnxruntime.dll" }
                        #[cfg(target_os = "linux")]
                        { "libonnxruntime.so" }
                        #[cfg(target_os = "macos")]
                        { "libonnxruntime.dylib" }
                        #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
                        { "libonnxruntime.so" }
                    };
                    let ort_library_path = resource_path.join(ort_library_name);
                    std::env::set_var("ORT_DYLIB_PATH", &ort_library_path);
                    println!("Set ORT_DYLIB_PATH to: {}", ort_library_path.display());
                }
            }

            setup_logging(&app_handle);

            if let Some(backend) = &settings.processing_backend
                && backend != "auto" {
                    log::info!("Applied processing backend setting: {}", backend);
                }
            if settings.linux_gpu_optimization.unwrap_or(false) {
                #[cfg(target_os = "linux")]
                {
                    log::info!("Applied Linux GPU optimizations.");
                }
            }

            #[cfg(feature = "advanced-codecs")]
            rapidraw_codecs::register_jxl_decoding_hook();

            let window_cfg = app.config().app.windows.first().unwrap().clone();
            let decorations = settings.decorations.unwrap_or(window_cfg.decorations);
            #[cfg(target_os = "android")]
            let _ = decorations;

            let main_window_cfg = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .expect("Main window config not found")
                .clone();

            let mut window_builder =
                tauri::WebviewWindowBuilder::from_config(app.handle(), &main_window_cfg)
                    .unwrap();

            #[cfg(not(target_os = "android"))]
            {
                window_builder = window_builder.decorations(decorations).visible(false);
            }

            let window = window_builder.build().expect("Failed to build window");
            app.state::<AppState>().startup_trace.mark(
                NativeStartupPhase::WindowCreated,
                "ok",
                None,
            );

            #[cfg(target_os = "macos")]
            {
                let resolver_app = app.handle().clone();
                let publisher_app = app.handle().clone();
                let coordinator =
                    crate::app::display_target::DisplayTargetCoordinator::new_with_publisher(
                        Duration::from_millis(120),
                        move |_| crate::app::display_target::resolve_for_app(&resolver_app),
                        move |change| {
                            if let Err(error) = publisher_app.emit("display-target-changed", change) {
                                log::warn!("failed to publish display target change: {error}");
                            }
                        },
                    );
                coordinator.request_refresh(0);
                *app.state::<AppState>()
                    .display_target_coordinator
                    .lock()
                    .unwrap() = Some(coordinator);
                #[cfg(feature = "validation-harness")]
                crate::app::display_target::start_validation_benchmark(app.handle().clone());
            }

            #[cfg(target_os = "android")]
            android_integration::initialize_android(&window);

            #[cfg(not(target_os = "android"))]
            {
                if let Ok(config_dir) = app.path().app_config_dir() {
                    let path = config_dir.join("window_state.json");
                    if let Ok(contents) = std::fs::read_to_string(&path) {
                        if let Ok(state) = serde_json::from_str::<WindowState>(&contents) {
                            restore_window_state(&window, &state);
                        } else {
                            let _ = window.center();
                        }
                    } else {
                        let _ = window.center();
                    }
                } else {
                    let _ = window.center();
                }

                if let Err(error) = window.show() {
                    log::error!("Failed to show startup shell: {}", error);
                }
                if let Err(error) = window.set_focus() {
                    log::error!("Failed to focus startup shell: {}", error);
                }
                app.state::<AppState>().startup_trace.mark(
                    NativeStartupPhase::WindowVisible,
                    "ok",
                    Some("webview-bootstrap-chrome".to_string()),
                );

                preview_worker::start_preview_worker(app.handle().clone());
                let state = app.state::<AppState>();
                state.services.analytics.start_worker(app.handle().clone());
                file_management::start_thumbnail_workers(app.handle().clone());
                app.state::<AppState>().startup_trace.mark(
                    NativeStartupPhase::CoreCommandsReady,
                    "ok",
                    Some("background-services-scheduled".to_string()),
                );

                let window_failsafe = window.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(4)).await;
                    if let Ok(false) = window_failsafe.is_visible() {
                        log::warn!(
                            "Frontend failed to report ready within timeout. Forcing window visibility."
                        );
                        let _ = window_failsafe.show();
                        let _ = window_failsafe.set_focus();
                    }
                });

                let pending_window_state = Arc::new(Mutex::new(None::<WindowState>));
                let pending_state_for_saver = pending_window_state.clone();
                let app_handle_for_saver = app.handle().clone();

                tauri::async_runtime::spawn(async move {
                    loop {
                        tokio::time::sleep(Duration::from_millis(500)).await;

                        let state_to_save = {
                            let mut lock = pending_state_for_saver.lock().unwrap();
                            lock.take()
                        };

                        if let Some(state) = state_to_save
                            && let Ok(config_dir) =
                                app_handle_for_saver.path().app_config_dir()
                        {
                            let path = config_dir.join("window_state.json");
                            let _ = std::fs::create_dir_all(&config_dir);
                            if let Ok(json) = serde_json::to_string(&state) {
                                let _ = std::fs::write(&path, json);
                            }
                        }
                    }
                });

                let window_for_handler = window.clone();
                let pending_state_for_handler = pending_window_state;

                window.on_window_event(move |event| match event {
                    tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_) => {
                        #[cfg(any(windows, target_os = "linux"))]
                        let maximized = window_for_handler.is_maximized().unwrap_or(false);
                        #[cfg(not(any(windows, target_os = "linux")))]
                        let maximized = false;

                        #[cfg(any(windows, target_os = "linux"))]
                        let fullscreen = window_for_handler.is_fullscreen().unwrap_or(false);
                        #[cfg(not(any(windows, target_os = "linux")))]
                        let fullscreen = false;

                        if window_for_handler.is_minimized().unwrap_or(false) {
                            return;
                        }

                        let mut state = WindowState {
                            width: 1280,
                            height: 720,
                            x: 0,
                            y: 0,
                            maximized,
                            fullscreen,
                        };

                        if let Ok(position) = window_for_handler.outer_position() {
                            state.x = position.x;
                            state.y = position.y;
                        }

                        if !maximized
                            && !fullscreen
                            && let Ok(size) = window_for_handler.outer_size()
                            && size.width >= 800
                            && size.height >= 600
                        {
                            state.width = size.width;
                            state.height = size.height;
                        }

                        *pending_state_for_handler.lock().unwrap() = Some(state);
                    }
                    _ => {}
                });
            }

            crate::register_exit_handler();
            #[cfg(all(feature = "validation-harness", unix))]
            qa_control::start(app.handle().clone()).map_err(std::io::Error::other)?;
            Ok(())
        })
        .manage(AppState::new())
        .manage(library::changefeed::LibraryFilesystemChangefeed::default())
        .manage(library::catalog::LibraryCatalog::default())
        .invoke_handler(tauri::generate_handler![
            app::commands::preview::apply_adjustments,
            app::commands::soft_proof_preview::generate_export_soft_proof_preview,
            app::commands::soft_proof_preview::resolve_export_soft_proof_transform_metadata,
            app::commands::path_preview::generate_preview_for_path,
            app::commands::negative_lab_dust::analyze_negative_lab_dust_spots,
            app::commands::original_preview::generate_original_transformed_preview,
            app::commands::viewer_sampling::sample_viewer_pixel,
            app::commands::preset_previews::generate_preset_preview,
            app::commands::uncropped_preview::generate_uncropped_preview,
            preview_geometry_transform,
            app::commands::logging::get_log_file_path,
            app::commands::logging::frontend_log,
            app::commands::collage::save_collage,
            merge::hdr::runtime_commands::merge_hdr,
            merge::hdr::commands::cancel_hdr_plan,
            merge::focus_stack::commands::plan_focus_stack,
            merge::focus_stack::commands::cancel_focus_stack_plan,
            merge::focus_stack::job::prepare_focus_stack_candidate,
            merge::focus_stack::job::read_focus_stack_job,
            merge::focus_stack::apply::apply_focus_stack_candidate,
            merge::focus_stack::retouch::apply_focus_stack_retouch,
            merge::focus_stack::retouch::open_focus_stack_retouch,
            merge::focus_stack::retouch::navigate_focus_stack_retouch,
            merge::hdr::runtime_commands::save_hdr,
            app::commands::lut::load_and_parse_lut,
            app::commands::community_presets::fetch_community_presets,
            app::commands::preset_previews::generate_all_community_previews,
            app::commands::temporary_artifacts::save_temp_file,
            app::commands::source::get_image_dimensions,
            app::commands::perspective::analyze_perspective_correction,
            app::commands::source::is_original_file_available,
            app::commands::source::resolve_original_source_identity,
            app::commands::startup::frontend_ready,
            app::commands::startup::get_startup_trace,
            app::commands::startup::record_frontend_startup_phase,
            library::changefeed::configure_library_changefeed,
            library::changefeed::get_library_changefeed_report,
            library::file_management::get_library_change_rows,
            library::catalog::open_library_collection,
            library::catalog::next_library_collection_page,
            library::catalog::reconcile_library_catalog,
            library::catalog::apply_library_catalog_changes,
            library::catalog::get_library_catalog_report,
            library::catalog::get_library_folder_aggregates,
            app::commands::thumbnail::cancel_thumbnail_generation,
            app::commands::wgpu_presentation::update_wgpu_transform,
            app::commands::wgpu_presentation::flush_wgpu_presentation,
            app::commands::wgpu_presentation::get_wgpu_presentation_report,
            editor::picker_commands::analyze_tone_equalizer_placement,
            editor::picker_commands::sample_tone_equalizer_picker,
            editor::picker_commands::sample_point_color_picker,
            app::display_target::get_display_target_report,
            app::commands::wgpu_presentation::get_gpu_pipeline_report,
            android_integration::resolve_android_content_uri_name,
            cache_utils::clear_session_caches,
            cache_utils::clear_image_caches,
            app_settings::load_settings,
            app_settings::save_settings,
            app::capabilities::get_native_capabilities,
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
            denoise_api::dry_run_denoise_controls,
            denoising::apply_denoising,
            denoising::execute_denoising,
            denoising::cancel_denoising,
            denoising::batch_denoise_images,
            denoising::save_denoised_image,
            display_profile::get_active_display_profile,
            display_profile::get_display_preview_lut_status,
            color::camera_profile::registry::list_camera_profiles,
            color::camera_profile::registry::import_camera_profile,
            color::camera_profile::registry::remove_camera_profile,
            color::camera_profile::registry::reveal_camera_profile,
            color::calibration::fit_and_publish_chart_calibration,
            color::calibration::fit_chart_calibration_report,
            color::calibration::list_supported_chart_definitions,
            color::calibration::validate_chart_capture_geometry,
            image_loader::compare_raw_reconstruction_modes,
            image_loader::load_image,
            image_open_session::begin_image_open,
            image_open_session::schedule_image_prefetch,
            image_open_session::get_image_open_diagnostics,
            image_loader::is_image_cached,
            merge::hdr::commands::plan_hdr,
            super_resolution::plan_super_resolution,
            super_resolution::cancel_super_resolution_registration,
            super_resolution::job::prepare_burst_sr_candidate,
            super_resolution::job::read_burst_sr_candidate_job,
            super_resolution::apply::apply_burst_sr_candidate,
            super_resolution::single_image::get_single_image_x2_capability,
            super_resolution::single_image::preview_single_image_x2,
            super_resolution::single_image::apply::apply_single_image_x2,
            super_resolution::single_image::batch::queue_single_image_x2_batch,
            super_resolution::single_image::cancel_single_image_x2_preview,
            merge::computational_job::cancel_computational_merge_job,
            panorama_stitching::plan_panorama,
            panorama_stitching::cancel_panorama_alignment,
            panorama_stitching::stitch_panorama,
            panorama_stitching::save_panorama,
            export::export_processing::get_export_color_capabilities,
            export::export_processing::get_hdr_export_capabilities,
            export::export_processing::export_images,
            export::export_processing::resume_export,
            export::export_processing::cancel_export,
            export::export_processing::estimate_export_sizes,
            auto_adjust::calculate_auto_adjustments,
            auto_adjust::calculate_legacy_auto_adjustments_v1,
            color::auto_edit::analyze_auto_edit,
            color::auto_edit::preview_auto_edit_proposal,
            color::auto_edit::apply_auto_edit_proposal,
            color::auto_edit::cancel_auto_edit_analysis,
            mask_generation::generate_mask_overlay,
            file_management::update_exif_fields,
            file_management::get_supported_file_types,
            file_management::read_exif_for_paths,
            file_management::check_xmp_metadata_conflicts,
            file_management::read_library_relink_identity,
            file_management::list_images_in_dir,
            file_management::list_images_recursive,
            file_management::get_folder_tree,
            file_management::get_folder_children,
            file_management::get_folder_refresh_snapshot,
            file_management::get_pinned_folder_trees,
            file_management::update_thumbnail_queue,
            thumbnail_resources::get_thumbnail_resource,
            thumbnail_resources::get_thumbnail_transport_metrics,
            file_management::create_folder,
            file_management::delete_folder,
            file_management::copy_files,
            file_management::move_files,
            file_management::rename_folder,
            file_management::rename_files,
            file_management::duplicate_file,
            file_management::show_in_finder,
            file_management::delete_files_from_disk,
            file_management::delete_files_with_associated,
            file_management::save_metadata_and_update_thumbnail,
            file_management::import_external_editor_variant,
            file_management::get_external_editor_file_watch_snapshot,
            file_management::launch_external_editor,
            file_management::apply_adjustments_to_paths,
            file_management::load_metadata,
            presets::load_presets,
            presets::save_presets,
            file_management::get_or_create_internal_library_root,
            file_management::reset_adjustments_for_paths,
            file_management::apply_auto_adjustments_to_paths,
            file_management::commit_batch_auto_adjustment,
            presets::handle_import_presets_from_file,
            presets::handle_import_legacy_presets_from_file,
            presets::handle_export_presets_to_file,
            presets::save_community_preset,
            file_management::clear_all_sidecars,
            #[cfg(feature = "validation-harness")]
            color_gpu_readback_probe::run_color_gpu_readback_probe,
            #[cfg(feature = "validation-harness")]
            raw_open_edit_export_proof::run_raw_open_edit_export_proof,
            file_management::clear_thumbnail_cache,
            file_management::set_color_label_for_paths,
            file_management::set_rating_for_paths,
            file_management::resolve_xmp_metadata_conflicts,
            file_management::import_files,
            file_management::cancel_import,
            file_management::get_active_import_job_status,
            file_management::get_import_job_receipt,
            file_management::validate_import_job_resume,
            file_management::resume_import_job,
            file_management::create_virtual_copy,
            album_management::get_albums,
            album_management::save_albums,
            album_management::add_to_album,
            file_management::get_album_images,
            tagging::indexing::start_background_indexing,
            tagging::indexing::cancel_background_indexing,
            tagging::clear_ai_tags,
            tagging::clear_all_tags,
            tagging::add_tag_for_paths,
            tagging::remove_tag_for_paths,
            culling::cull_images,
            tethering::discover_tethered_cameras,
            tethering::open_tether_session,
            tethering::get_tether_session,
            tethering::close_tether_session,
            tethering::set_tether_camera_control,
            tethering::trigger_tether_capture,
            deblur_api::dry_run_deblur_controls,
            lens_correction::get_lensfun_makers,
            lens_correction::get_lensfun_lenses_for_maker,
            lens_correction::autodetect_lens,
            lens_correction::get_lens_distortion_params,
            negative_conversion::preview_negative_conversion,
            negative_conversion::preflight_negative_lab_source,
            negative_conversion::fit_negative_lab_measured_profile,
            negative_conversion::lock_negative_lab_roll_bounds,
            negative_conversion::render_negative_lab_dry_run_preview_artifact,
            negative_conversion::estimate_negative_base_fog,
            negative_conversion::suggest_negative_lab_neutral_patch_rgb_balance,
            negative_conversion::suggest_negative_lab_highlight_patch_exposure,
            negative_conversion::suggest_negative_lab_shadow_patch_black_point,
            negative_conversion::convert_negatives,
            negative_lab_profiles::read_negative_lab_measured_profile_library,
            negative_lab_profiles::write_negative_lab_measured_profile_library,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(#[allow(unused_variables)] |app_handle, event| {
            match event {
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Opened { urls } => {
                    if let Some(url) = urls.first()
                        && let Ok(path) = url.to_file_path()
                        && let Some(path_str) = path.to_str()
                    {
                        crate::app::commands::startup::publish_file_open(
                            app_handle,
                            path_str.to_string(),
                        );
                        log::info!("macOS file open: Published path {}.", path_str);
                    }
                }
                tauri::RunEvent::ExitRequested { api, .. } => {
                    api.prevent_exit();

                    #[cfg(target_os = "macos")]
                    unsafe { libc::_exit(0); }

                    #[cfg(not(target_os = "macos"))]
                    std::process::exit(0);
                }
                tauri::RunEvent::Exit => {
                    #[cfg(target_os = "macos")]
                    unsafe { libc::_exit(0); }

                    #[cfg(not(target_os = "macos"))]
                    std::process::exit(0);
                }
                _ => {}
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_test_lut(path: &std::path::Path, middle: f32) {
        let mut cube = String::from("LUT_3D_SIZE 2\n");
        for _ in 0..8 {
            cube.push_str(&format!("0 {middle} 1\n"));
        }
        std::fs::write(path, cube).unwrap();
    }

    #[test]
    fn lut_processing_cache_reuses_content_and_invalidates_replaced_path() {
        let temp = tempfile::tempdir().unwrap();
        let first_path = temp.path().join("first.cube");
        let alias_path = temp.path().join("alias.cube");
        write_test_lut(&first_path, 0.5);
        write_test_lut(&alias_path, 0.5);
        let state = AppState::new();

        let first = get_or_load_lut(&state, first_path.to_str().unwrap()).unwrap();
        let warm = get_or_load_lut(&state, first_path.to_str().unwrap()).unwrap();
        let alias = get_or_load_lut(&state, alias_path.to_str().unwrap()).unwrap();
        assert!(Arc::ptr_eq(&first, &warm));
        assert!(Arc::ptr_eq(&first, &alias));

        let replacement = temp.path().join("replacement.cube");
        write_test_lut(&replacement, 0.25);
        std::fs::rename(&replacement, &first_path).unwrap();
        let changed = get_or_load_lut(&state, first_path.to_str().unwrap()).unwrap();
        assert!(!Arc::ptr_eq(&first, &changed));
        assert_ne!(first.content_hash, changed.content_hash);
    }
}
