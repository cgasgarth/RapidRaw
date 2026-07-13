use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

#[cfg(target_os = "windows")]
use tauri::Manager;

use crate::AppState;
#[cfg(target_os = "windows")]
use crate::app_settings;
#[cfg(not(target_os = "windows"))]
use crate::gpu_display::WgpuPresentationScheduler;
#[cfg(target_os = "windows")]
use crate::gpu_display::{WgpuPresentationScheduler, create_wgpu_display};
use crate::image_processing::GpuContext;

static NEXT_DEVICE_GENERATION: AtomicU64 = AtomicU64::new(1);

#[cfg(all(test, feature = "tauri-test"))]
static GPU_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(all(test, feature = "tauri-test"))]
static GPU_TEST_CONTEXT: std::sync::OnceLock<Result<GpuContext, String>> =
    std::sync::OnceLock::new();

/// Software WGPU adapters such as lavapipe are not reliable when separate test
/// devices execute compute workloads concurrently. Keep only GPU-owning tests
/// mutually exclusive; CPU tests continue to use Cargo's normal parallelism.
#[cfg(all(test, feature = "tauri-test"))]
pub(crate) fn acquire_gpu_test_lock() -> std::sync::MutexGuard<'static, ()> {
    GPU_TEST_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

pub fn get_or_init_gpu_context(
    state: &tauri::State<AppState>,
    _app_handle: &tauri::AppHandle,
) -> Result<GpuContext, String> {
    #[cfg(target_os = "windows")]
    let app_handle = _app_handle;

    let mut context_lock = state.gpu_context.lock().unwrap();
    if let Some(context) = &*context_lock {
        return Ok(context.clone());
    }

    #[allow(unused_mut)]
    let mut instance_desc = wgpu::InstanceDescriptor::new_without_display_handle_from_env();

    #[cfg(target_os = "windows")]
    if std::env::var("WGPU_BACKEND").is_err() {
        instance_desc.backends = wgpu::Backends::PRIMARY;
    }

    let flag_path = state.gpu_crash_flag_path.lock().unwrap().clone();
    if let Some(p) = &flag_path {
        if let Some(parent) = p.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(p, "initializing_gpu");
    }

    let instance = wgpu::Instance::new(instance_desc);

    #[cfg(target_os = "windows")]
    let surface_opt = {
        let settings = app_settings::load_settings_or_default(app_handle);
        let use_wgpu_renderer = settings.use_wgpu_renderer.unwrap_or(true);

        if use_wgpu_renderer {
            if let Some(window) = app_handle.get_webview_window("main") {
                match instance.create_surface(window) {
                    Ok(surface) => Some(surface),
                    Err(e) => {
                        log::warn!(
                            "Failed to create surface, falling back to compute-only: {}",
                            e
                        );
                        if let Some(p) = &flag_path {
                            let _ = std::fs::remove_file(p);
                        }
                        None
                    }
                }
            } else {
                None
            }
        } else {
            None
        }
    };

    #[cfg(not(target_os = "windows"))]
    let surface_opt: Option<wgpu::Surface<'static>> = None;

    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        compatible_surface: surface_opt.as_ref(),
        ..Default::default()
    }))
    .map_err(|e| {
        if let Some(p) = &flag_path {
            let _ = std::fs::remove_file(p);
        }
        format!("Failed to find a wgpu adapter: {}", e)
    })?;

    let mut required_features = wgpu::Features::empty();
    if adapter
        .features()
        .contains(wgpu::Features::TEXTURE_ADAPTER_SPECIFIC_FORMAT_FEATURES)
    {
        required_features |= wgpu::Features::TEXTURE_ADAPTER_SPECIFIC_FORMAT_FEATURES;
    }

    let limits = adapter.limits();

    let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
        label: Some("Processing Device"),
        required_features,
        required_limits: limits.clone(),
        experimental_features: wgpu::ExperimentalFeatures::default(),
        memory_hints: wgpu::MemoryHints::Performance,
        trace: wgpu::Trace::Off,
    }))
    .map_err(|e| {
        if let Some(p) = &flag_path {
            let _ = std::fs::remove_file(p);
        }
        e.to_string()
    })?;

    if let Some(p) = &flag_path {
        let _ = std::fs::remove_file(p);
    }

    #[cfg(target_os = "windows")]
    let display_opt = surface_opt.map(|surface| {
        let window = app_handle
            .get_webview_window("main")
            .expect("main window should exist for WGPU display initialization");

        create_wgpu_display(surface, &adapter, &device, &queue, &window)
    });

    #[cfg(not(target_os = "windows"))]
    let display_opt = None;

    let device = Arc::new(device);
    let queue = Arc::new(queue);
    let presentation =
        WgpuPresentationScheduler::new(display_opt, Arc::clone(&device), Arc::clone(&queue));
    let new_context = GpuContext {
        generation: NEXT_DEVICE_GENERATION.fetch_add(1, Ordering::Relaxed),
        device,
        queue,
        limits,
        presentation: Arc::new(presentation),
    };
    *context_lock = Some(new_context.clone());
    drop(context_lock);
    if let Some(coordinator) = state.display_target_coordinator.lock().unwrap().as_ref() {
        coordinator.request_refresh(new_context.generation);
    }
    Ok(new_context)
}

#[cfg(all(test, feature = "tauri-test"))]
pub fn get_or_init_compute_gpu_context_for_tests(
    state: &tauri::State<AppState>,
) -> Result<GpuContext, String> {
    let mut context_lock = state.gpu_context.lock().unwrap();
    if let Some(context) = &*context_lock {
        return Ok(context.clone());
    }

    // Reuse one process-wide compute device across test AppStates. Software
    // Vulkan adapters can retire a dropped device after the next one starts,
    // leaving otherwise serialized compute output unwritten. Product state and
    // processors remain isolated; only the adapter/device/queue are shared.
    let new_context = GPU_TEST_CONTEXT
        .get_or_init(|| {
            let instance = wgpu::Instance::new(
                wgpu::InstanceDescriptor::new_without_display_handle_from_env(),
            );
            let adapter =
                pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
                    power_preference: wgpu::PowerPreference::HighPerformance,
                    compatible_surface: None,
                    ..Default::default()
                }))
                .map_err(|error| format!("Failed to find a wgpu adapter: {error}"))?;

            let mut required_features = wgpu::Features::empty();
            if adapter
                .features()
                .contains(wgpu::Features::TEXTURE_ADAPTER_SPECIFIC_FORMAT_FEATURES)
            {
                required_features |= wgpu::Features::TEXTURE_ADAPTER_SPECIFIC_FORMAT_FEATURES;
            }
            let limits = adapter.limits();
            let (device, queue) =
                pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
                    label: Some("Shared Test Processing Device"),
                    required_features,
                    required_limits: limits.clone(),
                    experimental_features: wgpu::ExperimentalFeatures::default(),
                    memory_hints: wgpu::MemoryHints::Performance,
                    trace: wgpu::Trace::Off,
                }))
                .map_err(|error| error.to_string())?;

            let device = Arc::new(device);
            let queue = Arc::new(queue);
            Ok(GpuContext {
                generation: NEXT_DEVICE_GENERATION.fetch_add(1, Ordering::Relaxed),
                device: Arc::clone(&device),
                queue: Arc::clone(&queue),
                limits,
                presentation: Arc::new(WgpuPresentationScheduler::new(None, device, queue)),
            })
        })
        .clone()?;
    *context_lock = Some(new_context.clone());
    drop(context_lock);
    if let Some(coordinator) = state.display_target_coordinator.lock().unwrap().as_ref() {
        coordinator.request_refresh(new_context.generation);
    }
    Ok(new_context)
}

#[cfg(all(test, feature = "tauri-test"))]
mod tests {
    use super::*;
    use tauri::Manager;

    #[test]
    fn compute_test_context_reuses_one_device_across_isolated_app_states() {
        let _guard = acquire_gpu_test_lock();
        let first_app = tauri::test::mock_builder()
            .manage(AppState::new())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let second_app = tauri::test::mock_builder()
            .manage(AppState::new())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let first = get_or_init_compute_gpu_context_for_tests(&first_app.state()).unwrap();
        let second = get_or_init_compute_gpu_context_for_tests(&second_app.state()).unwrap();

        assert!(Arc::ptr_eq(&first.device, &second.device));
        assert!(Arc::ptr_eq(&first.queue, &second.queue));
        assert_eq!(first.generation, second.generation);
    }
}
