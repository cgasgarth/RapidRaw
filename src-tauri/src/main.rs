#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "macos")]
    rapidraw_lib::prepare_macos_startup_shell();
    rapidraw_lib::run();
}
