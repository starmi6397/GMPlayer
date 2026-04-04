//! Minimal iOS / Android backend: HTTP + logging only; no multi-window, tray, or decorum.

use crate::shared;

pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![shared::detect_desktop])
        .setup(|_app| Ok(()))
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {});
}
