use tauri::command;

/// Returns whether the app is running on desktop (non-mobile) targets.
#[command]
pub fn detect_desktop() -> bool {
    !cfg!(mobile)
}
