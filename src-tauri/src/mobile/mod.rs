//! Mobile (iOS / Android) backend: HTTP, logging, and Android media notification.
//!
//! Intentionally minimal — no multi-window management, no system tray, no decorum.
//! The [`media_session`] sub-module owns the bridge to the Android
//! `MediaNotification` Kotlin plugin.

pub mod media_session;

use crate::shared;

pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_http::init())
        // Register the Android MediaNotification / MediaPlaybackService bridge.
        // On non-Android targets this is compiled as a no-op plugin so the same
        // binary can be built for iOS and simulator targets without any changes.
        .plugin(media_session::init())
        .invoke_handler(tauri::generate_handler![shared::detect_desktop])
        .setup(|_app| Ok(()))
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {});
}
