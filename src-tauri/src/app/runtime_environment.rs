use std::path::PathBuf;

use tauri::Manager;

use crate::{AppSettings, AppState};

#[derive(Clone, Debug, Eq, PartialEq)]
struct RuntimeEnvironmentPlan {
    backend_override: Option<String>,
    linux_webkit_workarounds: bool,
    ort_library_name: &'static str,
}

impl RuntimeEnvironmentPlan {
    fn compile(settings: &AppSettings, platform: &str) -> Self {
        Self {
            backend_override: settings
                .processing_backend
                .as_ref()
                .filter(|backend| backend.as_str() != "auto")
                .cloned(),
            linux_webkit_workarounds: platform == "linux"
                && settings.linux_gpu_optimization.unwrap_or(true),
            ort_library_name: match platform {
                "windows" => "onnxruntime.dll",
                "macos" => "libonnxruntime.dylib",
                _ => "libonnxruntime.so",
            },
        }
    }
}

pub(crate) fn configure(
    app: &tauri::AppHandle,
    state: &AppState,
    mut settings: AppSettings,
) -> AppSettings {
    let config_dir = app
        .path()
        .app_config_dir()
        .expect("Failed to get config dir");
    let crash_flag_path = config_dir.join(".gpu_init_crash_flag");
    state.gpu().configure_crash_marker(crash_flag_path.clone());

    if apply_gpu_crash_recovery(&mut settings, crash_flag_path.exists()) {
        log::warn!("GPU Driver crash detected on last run! Falling back to OpenGL backend.");
        let _ = crate::save_settings(settings.clone(), app.clone());
        let _ = std::fs::remove_file(&crash_flag_path);
    }

    let plan = RuntimeEnvironmentPlan::compile(&settings, std::env::consts::OS);
    let resource_root = resolve_resource_root(app);
    // Setup invokes this before background workers start. Rust 2024 therefore requires the
    // caller to make this single-threaded process-environment mutation explicit.
    unsafe { apply_environment(&plan, resource_root) };
    if let Some(backend) = &plan.backend_override {
        log::info!("Applied processing backend setting: {backend}");
    }
    if plan.linux_webkit_workarounds {
        log::info!("Applied Linux GPU optimizations.");
    }
    settings
}

fn apply_gpu_crash_recovery(settings: &mut AppSettings, crash_marker_exists: bool) -> bool {
    if !crash_marker_exists {
        return false;
    }
    settings.processing_backend = Some("gl".to_string());
    true
}

#[cfg(not(target_os = "android"))]
fn resolve_resource_root(app: &tauri::AppHandle) -> Option<PathBuf> {
    Some(
        app.path()
            .resolve("resources", tauri::path::BaseDirectory::Resource)
            .expect("failed to resolve resource directory"),
    )
}

#[cfg(target_os = "android")]
fn resolve_resource_root(_app: &tauri::AppHandle) -> Option<PathBuf> {
    None
}

unsafe fn apply_environment(plan: &RuntimeEnvironmentPlan, resource_root: Option<PathBuf>) {
    if let Some(backend) = &plan.backend_override {
        unsafe { std::env::set_var("WGPU_BACKEND", backend) };
    }
    if plan.linux_webkit_workarounds {
        unsafe {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
            std::env::set_var("NODEVICE_SELECT", "1");
        }
    }
    if let Some(resource_root) = resource_root {
        let ort_library_path = resource_root.join(plan.ort_library_name);
        unsafe { std::env::set_var("ORT_DYLIB_PATH", &ort_library_path) };
        println!("Set ORT_DYLIB_PATH to: {}", ort_library_path.display());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn automatic_backend_does_not_override_wgpu_selection() {
        let settings = AppSettings {
            processing_backend: Some("auto".to_string()),
            ..AppSettings::default()
        };
        assert_eq!(
            RuntimeEnvironmentPlan::compile(&settings, "macos").backend_override,
            None
        );
    }

    #[test]
    fn explicit_backend_and_platform_runtime_are_compiled_together() {
        let settings = AppSettings {
            processing_backend: Some("metal".to_string()),
            linux_gpu_optimization: Some(true),
            ..AppSettings::default()
        };
        assert_eq!(
            RuntimeEnvironmentPlan::compile(&settings, "linux"),
            RuntimeEnvironmentPlan {
                backend_override: Some("metal".to_string()),
                linux_webkit_workarounds: true,
                ort_library_name: "libonnxruntime.so",
            }
        );
        assert_eq!(
            RuntimeEnvironmentPlan::compile(&settings, "windows").ort_library_name,
            "onnxruntime.dll"
        );
        assert_eq!(
            RuntimeEnvironmentPlan::compile(&settings, "macos").ort_library_name,
            "libonnxruntime.dylib"
        );
    }

    #[test]
    fn crash_recovery_forces_gl_once_without_mutating_clean_startup() {
        let mut clean = AppSettings::default();
        let original = clean.processing_backend.clone();
        assert!(!apply_gpu_crash_recovery(&mut clean, false));
        assert_eq!(clean.processing_backend, original);

        assert!(apply_gpu_crash_recovery(&mut clean, true));
        assert_eq!(clean.processing_backend.as_deref(), Some("gl"));
    }
}
