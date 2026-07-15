use std::{fs, panic};

#[cfg(target_os = "macos")]
use std::{sync::Arc, time::Duration};
#[cfg(target_os = "macos")]
use tauri::Emitter;
use tauri::Manager;

use crate::app::startup::NativeStartupPhase;
use crate::app::{command_registration, window_lifecycle};
use crate::window_customizer::PinchZoomDisablePlugin;
use crate::{AppSettings, AppState};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum BackgroundServiceAction {
    PreviewWorker,
    AnalyticsWorker,
    ThumbnailWorkers,
    MarkCoreCommandsReady,
    WindowVisibilityFailsafe,
    WindowPersistence,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ExitPolicy {
    PreventAndTerminate,
    Terminate,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ExitEventKind {
    Requested,
    Exit,
}

const fn exit_policy(kind: ExitEventKind) -> ExitPolicy {
    match kind {
        ExitEventKind::Requested => ExitPolicy::PreventAndTerminate,
        ExitEventKind::Exit => ExitPolicy::Terminate,
    }
}

const DESKTOP_BACKGROUND_SERVICE_PLAN: [BackgroundServiceAction; 6] = [
    BackgroundServiceAction::PreviewWorker,
    BackgroundServiceAction::AnalyticsWorker,
    BackgroundServiceAction::ThumbnailWorkers,
    BackgroundServiceAction::MarkCoreCommandsReady,
    BackgroundServiceAction::WindowVisibilityFailsafe,
    BackgroundServiceAction::WindowPersistence,
];

fn execute_background_service_plan(mut execute: impl FnMut(BackgroundServiceAction)) {
    for action in DESKTOP_BACKGROUND_SERVICE_PLAN {
        execute(action);
    }
}

#[cfg(not(target_os = "android"))]
fn start_background_services(app: &tauri::App, window: &tauri::WebviewWindow) {
    execute_background_service_plan(|action| match action {
        BackgroundServiceAction::PreviewWorker => {
            crate::preview_worker::start_preview_worker(app.handle().clone());
        }
        BackgroundServiceAction::AnalyticsWorker => {
            app.state::<AppState>()
                .services
                .analytics
                .start_worker(app.handle().clone());
        }
        BackgroundServiceAction::ThumbnailWorkers => {
            crate::file_management::start_thumbnail_workers(app.handle().clone());
        }
        BackgroundServiceAction::MarkCoreCommandsReady => {
            app.state::<AppState>().services.startup.mark(
                NativeStartupPhase::CoreCommandsReady,
                "ok",
                Some("background-services-scheduled".to_string()),
            );
        }
        BackgroundServiceAction::WindowVisibilityFailsafe => {
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
        }
        BackgroundServiceAction::WindowPersistence => {
            window_lifecycle::start_persistence(app.handle().clone(), window);
        }
    });
}

#[cfg(any(
    test,
    all(
        not(any(target_os = "android", target_os = "ios")),
        not(feature = "validation-harness")
    )
))]
fn single_instance_file_open(argv: &[String]) -> Option<String> {
    argv.get(1).cloned()
}

#[cfg(target_os = "macos")]
fn opened_file_path(urls: &[tauri::Url]) -> Option<String> {
    urls.first()
        .and_then(|url| url.to_file_path().ok())
        .and_then(|path| path.to_str().map(str::to_string))
}

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

fn setup_logging(app_handle: &tauri::AppHandle) {
    let log_dir = match app_handle.path().app_log_dir() {
        Ok(dir) => dir,
        Err(error) => {
            eprintln!("Failed to get app log directory: {error}");
            return;
        }
    };

    if let Err(error) = fs::create_dir_all(&log_dir) {
        eprintln!("Failed to create log directory at {log_dir:?}: {error}");
    }

    let log_file_path = log_dir.join("app.log");
    let log_file = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&log_file_path)
        .ok();
    let level = std::env::var("RUST_LOG")
        .unwrap_or_else(|_| "info".to_string())
        .parse()
        .unwrap_or(log::LevelFilter::Info);
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
        eprintln!("Failed to open log file at {log_file_path:?}. Logging to console only.");
    }
    if let Err(error) = dispatch.apply() {
        eprintln!("Failed to apply logger configuration: {error}");
    }
    panic::set_hook(Box::new(|info| {
        let message = if let Some(message) = info.payload().downcast_ref::<&'static str>() {
            message.to_string()
        } else if let Some(message) = info.payload().downcast_ref::<String>() {
            message.clone()
        } else {
            format!("{:?}", info.payload())
        };
        let location = info.location().map_or_else(
            || "at an unknown location".to_string(),
            |location| {
                format!(
                    "at {}:{}:{}",
                    location.file(),
                    location.line(),
                    location.column()
                )
            },
        );
        log::error!("PANIC! {} - {}", location, message.trim());
    }));
    log::info!("Logger initialized successfully. Log file at: {log_file_path:?}");
}

fn setup_application(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(any(windows, target_os = "linux"))]
    if let Some(path) = std::env::args().nth(1) {
        log::info!("Windows/Linux initial open: Storing path {path} for later.");
        crate::app::commands::startup::publish_file_open(app.handle(), path);
    }

    let app_handle = app.handle().clone();
    if let Err(error) = crate::color::camera_profile::registry::managed_profile_root(&app_handle) {
        log::warn!("camera_profile_registry_root_unavailable: {error}");
    }
    app.state::<AppState>()
        .services
        .startup
        .mark(NativeStartupPhase::ProcessStarted, "ok", None);
    let settings: AppSettings = crate::load_settings_or_default(&app_handle);
    app.state::<AppState>().services.startup.mark(
        NativeStartupPhase::MinimalSettingsLoaded,
        "ok",
        None,
    );
    let settings =
        crate::app::runtime_environment::configure(&app_handle, &app.state::<AppState>(), settings);
    {
        let state = app.state::<AppState>();
        crate::render_caches::RenderCaches::new(&state)
            .set_decoded_image_cache_capacity(settings.image_cache_size.unwrap_or(5) as usize);
    }
    setup_logging(&app_handle);
    #[cfg(feature = "advanced-codecs")]
    rapidraw_codecs::register_jxl_decoding_hook();

    let window_config = app.config().app.windows.first().unwrap().clone();
    let decorations = settings.decorations.unwrap_or(window_config.decorations);
    #[cfg(target_os = "android")]
    let _ = decorations;
    let main_window_config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .expect("Main window config not found")
        .clone();
    let mut window_builder =
        tauri::WebviewWindowBuilder::from_config(app.handle(), &main_window_config).unwrap();
    #[cfg(not(target_os = "android"))]
    {
        window_builder = window_builder.decorations(decorations).visible(false);
    }
    let window = window_builder.build().expect("Failed to build window");
    app.state::<AppState>()
        .services
        .startup
        .mark(NativeStartupPhase::WindowCreated, "ok", None);

    #[cfg(target_os = "macos")]
    {
        let resolver_app = app.handle().clone();
        let publisher_app = app.handle().clone();
        let state = app.state::<AppState>();
        let display_profile = Arc::clone(&state.services.display_profile);
        let coordinator = crate::app::display_target::DisplayTargetCoordinator::new_with_publisher(
            Duration::from_millis(120),
            move |_| crate::app::display_target::resolve_for_app(&resolver_app, &display_profile),
            move |change| {
                if let Err(error) = publisher_app.emit("display-target-changed", change) {
                    log::warn!("failed to publish display target change: {error}");
                }
            },
        );
        let context = state
            .services
            .gpu_context
            .install_coordinator(Arc::clone(&coordinator));
        coordinator.request_refresh(context.map_or(0, |context| context.generation));
        #[cfg(feature = "validation-harness")]
        crate::app::display_target::start_validation_benchmark(app.handle().clone());
    }

    #[cfg(target_os = "android")]
    crate::android_integration::initialize_android(&window);
    #[cfg(not(target_os = "android"))]
    {
        window_lifecycle::restore_or_center(app.handle(), &window);
        if let Err(error) = window.show() {
            log::error!("Failed to show startup shell: {error}");
        }
        if let Err(error) = window.set_focus() {
            log::error!("Failed to focus startup shell: {error}");
        }
        app.state::<AppState>().services.startup.mark(
            NativeStartupPhase::WindowVisible,
            "ok",
            Some("webview-bootstrap-chrome".to_string()),
        );
        start_background_services(app, &window);
    }
    register_exit_handler();
    #[cfg(all(feature = "validation-harness", unix))]
    crate::qa_control::start(app.handle().clone()).map_err(std::io::Error::other)?;
    Ok(())
}

fn configure_builder() -> tauri::Builder<tauri::Wry> {
    #[cfg_attr(feature = "validation-harness", allow(unused_mut))]
    let mut builder = tauri::Builder::default();
    #[cfg(all(feature = "validation-harness", unix))]
    {
        builder = builder.manage(crate::qa_control::QaControlState::from_environment());
    }
    #[cfg(all(
        not(any(target_os = "android", target_os = "ios")),
        not(feature = "validation-harness")
    ))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            log::info!("New instance launched with args: {argv:?}. Focusing main window.");
            if let Some(window) = app.get_webview_window("main") {
                if let Err(error) = window.unminimize() {
                    log::error!("Failed to unminimize window: {error}");
                }
                if let Err(error) = window.set_focus() {
                    log::error!("Failed to set focus on window: {error}");
                }
            }
            if let Some(path) = single_instance_file_open(&argv) {
                crate::app::commands::startup::publish_file_open(app, path);
            }
        }));
    }
    builder
        .register_uri_scheme_protocol(
            crate::thumbnail_resources::THUMBNAIL_PROTOCOL,
            |context, request| {
                crate::thumbnail_resources::protocol_response(context.app_handle(), request.uri())
            },
        )
        .register_uri_scheme_protocol(
            crate::analytics_resources::ANALYTICS_PROTOCOL,
            |_context, request| crate::analytics_resources::protocol_response(request.uri()),
        )
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(PinchZoomDisablePlugin)
        .on_window_event(window_lifecycle::handle_window_event)
        .setup(setup_application)
        .manage(AppState::new())
        .manage(crate::library::changefeed::LibraryFilesystemChangefeed::default())
        .manage(crate::library::catalog::LibraryCatalog::default())
        .invoke_handler(command_registration::invoke_handler())
}

fn handle_run_event(app_handle: &tauri::AppHandle, event: tauri::RunEvent) {
    #[cfg(not(target_os = "macos"))]
    let _ = app_handle;

    match event {
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Opened { urls } => {
            if let Some(path) = opened_file_path(&urls) {
                crate::app::commands::startup::publish_file_open(app_handle, path.clone());
                log::info!("macOS file open: Published path {path}.");
            }
        }
        tauri::RunEvent::ExitRequested { api, .. } => {
            if exit_policy(ExitEventKind::Requested) == ExitPolicy::PreventAndTerminate {
                api.prevent_exit();
            }
            terminate_process();
        }
        tauri::RunEvent::Exit => {
            debug_assert_eq!(exit_policy(ExitEventKind::Exit), ExitPolicy::Terminate);
            terminate_process();
        }
        _ => {}
    }
}

#[cfg(target_os = "macos")]
fn terminate_process() -> ! {
    unsafe { libc::_exit(0) }
}

#[cfg(not(target_os = "macos"))]
fn terminate_process() -> ! {
    std::process::exit(0)
}

pub(crate) fn run() {
    configure_builder()
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(handle_run_event);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn background_service_executor_preserves_startup_order() {
        let mut executed = Vec::new();
        execute_background_service_plan(|action| executed.push(action));
        assert_eq!(executed, DESKTOP_BACKGROUND_SERVICE_PLAN);
    }

    #[test]
    fn single_instance_handoff_requires_the_first_file_argument() {
        assert_eq!(single_instance_file_open(&["RapidRaw".to_string()]), None);
        assert_eq!(
            single_instance_file_open(&[
                "RapidRaw".to_string(),
                "/tmp/first.ARW".to_string(),
                "/tmp/ignored.ARW".to_string(),
            ]),
            Some("/tmp/first.ARW".to_string())
        );
    }

    #[test]
    fn exit_policy_preserves_requested_and_terminal_runtime_behavior() {
        assert_eq!(
            exit_policy(ExitEventKind::Requested),
            ExitPolicy::PreventAndTerminate
        );
        assert_eq!(exit_policy(ExitEventKind::Exit), ExitPolicy::Terminate);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn opened_event_handoff_accepts_files_and_rejects_non_file_urls() {
        assert_eq!(
            opened_file_path(&[tauri::Url::from_file_path("/tmp/opened.ARW").unwrap()]),
            Some("/tmp/opened.ARW".to_string())
        );
        assert_eq!(
            opened_file_path(&[tauri::Url::parse("https://example.com").unwrap()]),
            None
        );
    }
}
