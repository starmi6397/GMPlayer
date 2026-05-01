//! Mobile (iOS / Android) backend: HTTP, logging, and native media session.

use crate::shared;

/// Set the screen orientation.
/// On Android this is handled by the Kotlin side via the orientation plugin;
/// this command is kept as a no-op fallback for desktop / compatibility.
#[tauri::command]
fn set_screen_orientation(_orientation: String) -> Result<(), String> {
    Ok(())
}

/// Inline Tauri plugin that delegates screen-orientation control to the
/// Android Kotlin side (`OrientationPlugin`).
fn orientation_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("orientation")
        .setup(|_app, api| {
            #[cfg(target_os = "android")]
            api.register_android_plugin(
                "com.gbclstudio.gmplayer",
                "OrientationPlugin",
            )?;
            Ok(())
        })
        .build()
}

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
        .plugin(tauri_plugin_media_session::init())
        .plugin(orientation_plugin())
        .invoke_handler(tauri::generate_handler![
            shared::detect_desktop,
            set_screen_orientation
        ])
        .setup(|_app| Ok(()))
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {});
}
