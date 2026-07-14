use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::time::Duration;

use tauri::Emitter;
#[cfg(any(windows, target_os = "linux"))]
use tauri::Manager;

use crate::AppState;
#[cfg(any(windows, target_os = "linux"))]
use crate::WindowState;
use crate::app::startup::{
    FrontendStartupPhase, frontend_ready_manages_native_window, record_frontend_phase_with_followup,
};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use crate::app::startup::{
    InitializationPriority, request_gpu_initialization, request_lens_initialization,
};

fn handle_file_open(app_handle: &tauri::AppHandle, path: PathBuf) {
    if let Some(path_str) = path.to_str()
        && let Err(e) = app_handle.emit(crate::events::OPEN_WITH_FILE, path_str)
    {
        log::error!("Failed to emit open-with-file event: {}", e);
    }
}

#[cfg(all(feature = "validation-harness", unix))]
#[tauri::command]
pub(crate) fn frontend_ready(
    app_handle: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<AppState>,
    qa_control_state: tauri::State<crate::qa_control::QaControlState>,
) -> Result<(), String> {
    qa_control_state.mark_ready();
    frontend_ready_impl(app_handle, window, state)
}

#[cfg(not(all(feature = "validation-harness", unix)))]
#[tauri::command]
pub(crate) fn frontend_ready(
    app_handle: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    frontend_ready_impl(app_handle, window, state)
}

fn frontend_ready_impl(
    app_handle: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    let is_first_run = !state.window_setup_complete.swap(true, Ordering::Relaxed);
    #[cfg(target_os = "android")]
    let _ = (is_first_run, &window);

    #[cfg(not(target_os = "android"))]
    {
        #[cfg(not(any(windows, target_os = "linux")))]
        let _ = is_first_run;

        #[cfg(any(windows, target_os = "linux"))]
        let mut should_maximize = false;
        #[cfg(any(windows, target_os = "linux"))]
        let mut should_fullscreen = false;

        #[cfg(any(windows, target_os = "linux"))]
        if is_first_run && let Ok(config_dir) = app_handle.path().app_config_dir() {
            let path = config_dir.join("window_state.json");

            if let Ok(contents) = std::fs::read_to_string(&path)
                && let Ok(saved_state) = serde_json::from_str::<WindowState>(&contents)
            {
                should_maximize = saved_state.maximized;
                should_fullscreen = saved_state.fullscreen;

                if (should_maximize || should_fullscreen)
                    && let Some(monitor) = window
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
                {
                    let monitor_size = monitor.size();
                    let monitor_pos = monitor.position();
                    let default_width = 1280i32;
                    let default_height = 720i32;
                    let center_x = monitor_pos.x + (monitor_size.width as i32 - default_width) / 2;
                    let center_y =
                        monitor_pos.y + (monitor_size.height as i32 - default_height) / 2;

                    let _ = window.set_size(tauri::PhysicalSize::new(
                        default_width as u32,
                        default_height as u32,
                    ));
                    let _ = window.set_position(tauri::PhysicalPosition::new(center_x, center_y));
                }
            }
        }

        if frontend_ready_manages_native_window(std::env::consts::OS) {
            if let Err(e) = window.show() {
                log::error!("Failed to show window: {}", e);
            }
            if let Err(e) = window.set_focus() {
                log::error!("Failed to focus window: {}", e);
            }
        }
        #[cfg(any(windows, target_os = "linux"))]
        if is_first_run {
            if should_maximize {
                let _ = window.maximize();
            }
            if should_fullscreen {
                let _ = window.set_fullscreen(true);
            }
        }
    }

    if let Some(path) = state.initial_file_path.lock().unwrap().take() {
        log::info!(
            "Frontend is ready, emitting open-with-file for initial path: {}",
            &path
        );
        handle_file_open(&app_handle, PathBuf::from(path));
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn get_startup_trace(
    state: tauri::State<'_, AppState>,
) -> crate::app::startup::StartupTraceSnapshot {
    state.startup_trace.snapshot()
}

#[tauri::command]
pub(crate) fn record_frontend_startup_phase(
    trace_id: String,
    phase: FrontendStartupPhase,
    status: String,
    detail: Option<String>,
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<crate::app::startup::StartupTraceSnapshot, String> {
    record_frontend_phase_with_followup(
        &state.startup_trace,
        &trace_id,
        phase,
        &status,
        detail,
        |snapshot| {
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            if state.startup_trace.arm_idle_warm_after(phase) {
                let idle_services = app.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(Duration::from_millis(1_500)).await;
                    request_lens_initialization(
                        idle_services.clone(),
                        InitializationPriority::IdleWarm,
                    );
                    request_gpu_initialization(idle_services, InitializationPriority::IdleWarm);
                });
            }
            #[cfg(feature = "validation-harness")]
            if phase == FrontendStartupPhase::Interactive
                && std::env::var("RAWENGINE_STARTUP_BENCHMARK_EDITOR_DEMAND").as_deref() == Ok("1")
            {
                crate::image_open_session::promote_editor_initialization(&app);
                request_lens_initialization(app.clone(), InitializationPriority::IdleWarm);
                request_gpu_initialization(app, InitializationPriority::IdleWarm);
            }
            let _ = snapshot;
        },
    )
}
