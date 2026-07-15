use std::io::Write;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::AppState;

const MIN_WINDOW_WIDTH: u32 = 800;
const MIN_WINDOW_HEIGHT: u32 = 600;
const DEFAULT_WINDOW_WIDTH: u32 = 1280;
const DEFAULT_WINDOW_HEIGHT: u32 = 720;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub(crate) struct WindowState {
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub maximized: bool,
    pub fullscreen: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct WorkArea {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct RestoredBounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

fn restored_bounds(state: &WindowState, work_area: WorkArea) -> RestoredBounds {
    let max_width = work_area.width.max(1);
    let max_height = work_area.height.max(1);
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
    let max_x = work_area.x + work_area.width as i32 - width as i32;
    let max_y = work_area.y + work_area.height as i32 - height as i32;
    RestoredBounds {
        x: state.x.clamp(work_area.x, max_x.max(work_area.x)),
        y: state.y.clamp(work_area.y, max_y.max(work_area.y)),
        width,
        height,
    }
}

#[cfg(not(target_os = "android"))]
pub(crate) fn restore_or_center(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    let Ok(config_dir) = app.path().app_config_dir() else {
        let _ = window.center();
        return;
    };
    let Ok(contents) = std::fs::read_to_string(config_dir.join("window_state.json")) else {
        let _ = window.center();
        return;
    };
    let Ok(state) = serde_json::from_str::<WindowState>(&contents) else {
        let _ = window.center();
        return;
    };
    let Some(monitor) = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())
        .or_else(|| {
            window
                .available_monitors()
                .ok()
                .and_then(|monitors| monitors.into_iter().next())
        })
    else {
        let _ = window.center();
        return;
    };
    let work_area = monitor.work_area();
    let bounds = restored_bounds(
        &state,
        WorkArea {
            x: work_area.position.x,
            y: work_area.position.y,
            width: work_area.size.width,
            height: work_area.size.height,
        },
    );
    let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(
        bounds.width,
        bounds.height,
    )));
    let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
        bounds.x, bounds.y,
    )));
}

#[derive(Clone, Default)]
struct WindowStatePersistence {
    pending: Arc<Mutex<Option<WindowState>>>,
}

impl WindowStatePersistence {
    fn queue(&self, state: WindowState) {
        *self.pending.lock().unwrap() = Some(state);
    }

    fn take_pending(&self) -> Option<WindowState> {
        self.pending.lock().unwrap().take()
    }
}

#[cfg(not(target_os = "android"))]
pub(crate) fn start_persistence(app: tauri::AppHandle, window: &tauri::WebviewWindow) {
    let persistence = WindowStatePersistence::default();
    let saver = persistence.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(500)).await;
            let Some(state) = saver.take_pending() else {
                continue;
            };
            let Ok(config_dir) = app.path().app_config_dir() else {
                continue;
            };
            if let Err(error) = persist_window_state(&config_dir.join("window_state.json"), &state)
            {
                log::warn!("window state persistence failed: {error}");
            }
        }
    });

    let window = window.clone();
    window.clone().on_window_event(move |event| {
        if !matches!(
            event,
            tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_)
        ) || window.is_minimized().unwrap_or(false)
        {
            return;
        }

        #[cfg(any(windows, target_os = "linux"))]
        let maximized = window.is_maximized().unwrap_or(false);
        #[cfg(not(any(windows, target_os = "linux")))]
        let maximized = false;
        #[cfg(any(windows, target_os = "linux"))]
        let fullscreen = window.is_fullscreen().unwrap_or(false);
        #[cfg(not(any(windows, target_os = "linux")))]
        let fullscreen = false;

        let mut state = WindowState {
            width: DEFAULT_WINDOW_WIDTH,
            height: DEFAULT_WINDOW_HEIGHT,
            x: 0,
            y: 0,
            maximized,
            fullscreen,
        };
        if let Ok(position) = window.outer_position() {
            state.x = position.x;
            state.y = position.y;
        }
        if !maximized
            && !fullscreen
            && let Ok(size) = window.outer_size()
            && size.width >= MIN_WINDOW_WIDTH
            && size.height >= MIN_WINDOW_HEIGHT
        {
            state.width = size.width;
            state.height = size.height;
        }
        persistence.queue(state);
    });
}

fn persist_window_state(path: &Path, state: &WindowState) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "window state path has no parent".to_string())?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = path.with_extension(format!("tmp-{}", std::process::id()));
    let result = (|| {
        let bytes = serde_json::to_vec(state).map_err(|error| error.to_string())?;
        let mut file = std::fs::File::create(&temporary).map_err(|error| error.to_string())?;
        file.write_all(&bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        std::fs::rename(&temporary, path).map_err(|error| error.to_string())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

pub(crate) fn handle_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if let tauri::WindowEvent::Resized(size) = event {
        let state = window.state::<AppState>();
        if let Some(context) = state.services.gpu_context.context_snapshot() {
            context.presentation.resize(size.width, size.height);
        }
        #[cfg(target_os = "macos")]
        crate::app::display_target::request_for_state(&state);
    } else if matches!(
        event,
        tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Focused(true)
    ) {
        #[cfg(target_os = "macos")]
        crate::app::display_target::request_for_state(&window.state::<AppState>());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> WindowState {
        WindowState {
            width: 1280,
            height: 720,
            x: 0,
            y: 0,
            maximized: false,
            fullscreen: false,
        }
    }

    #[test]
    fn restored_bounds_clamp_invalid_size_and_offscreen_position() {
        let bounds = restored_bounds(
            &WindowState {
                width: 200,
                height: 5_000,
                x: -500,
                y: 5_000,
                ..state()
            },
            WorkArea {
                x: 100,
                y: 50,
                width: 1_400,
                height: 900,
            },
        );
        assert_eq!(
            bounds,
            RestoredBounds {
                x: 100,
                y: 50,
                width: 1_280,
                height: 900,
            }
        );
    }

    #[test]
    fn pending_window_state_coalesces_to_the_latest_event() {
        let persistence = WindowStatePersistence::default();
        persistence.queue(state());
        persistence.queue(WindowState {
            x: 77,
            y: 88,
            ..state()
        });
        let latest = persistence.take_pending().unwrap();
        assert_eq!((latest.x, latest.y), (77, 88));
        assert!(persistence.take_pending().is_none());
    }

    #[test]
    fn persisted_window_state_is_atomic_and_round_trips() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("window_state.json");
        let expected = WindowState {
            x: 20,
            y: 30,
            ..state()
        };
        persist_window_state(&path, &expected).unwrap();
        let restored: WindowState = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(restored, expected);
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    }
}
