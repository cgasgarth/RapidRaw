//! Frontend logging and log-file discovery commands.

use tauri::Manager;

#[tauri::command]
pub(crate) fn get_log_file_path(app_handle: tauri::AppHandle) -> Result<String, String> {
    let log_dir = app_handle
        .path()
        .app_log_dir()
        .map_err(|error| error.to_string())?;
    Ok(log_dir.join("app.log").to_string_lossy().to_string())
}

fn non_empty_lines(message: &str) -> impl Iterator<Item = &str> {
    message
        .trim()
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
}

#[tauri::command]
pub(crate) fn frontend_log(level: String, message: String) -> Result<(), String> {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Ok(());
    }

    let log_line = |line: &str| match level.to_lowercase().as_str() {
        "error" => log::error!("[frontend] {}", line),
        "warn" => log::warn!("[frontend] {}", line),
        "info" if line.starts_with("[app-event]") => log::warn!("[frontend] {}", line),
        "debug" => log::debug!("[frontend] {}", line),
        "trace" => log::trace!("[frontend] {}", line),
        _ => log::info!("[frontend] {}", line),
    };

    for line in non_empty_lines(trimmed) {
        log_line(line);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    #[test]
    fn frontend_log_ignores_empty_messages_and_preserves_line_boundaries() {
        frontend_log("info".into(), " \n\t".into()).unwrap();
        assert_eq!(
            non_empty_lines(" first\n\n second \n").collect::<Vec<_>>(),
            ["first", "second"]
        );
    }

    #[test]
    fn frontend_log_line_normalization_is_safe_for_concurrent_calls() {
        let workers = (0..8)
            .map(|index| {
                thread::spawn(move || {
                    let message = format!("event-{index}\n\n detail");
                    non_empty_lines(&message)
                        .map(str::to_owned)
                        .collect::<Vec<_>>()
                })
            })
            .collect::<Vec<_>>();
        for (index, worker) in workers.into_iter().enumerate() {
            assert_eq!(
                worker.join().expect("logging worker"),
                [format!("event-{index}"), "detail".into()]
            );
        }
    }
}
