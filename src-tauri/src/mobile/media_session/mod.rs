//! Android media notification bridge — Rust side.
//!
//! The Kotlin `MediaNotification` class (annotated `@TauriPlugin`) owns the foreground
//! `MediaPlaybackService` and keeps the system notification and `MediaSession` in sync.
//! This module wires it into Tauri so that:
//!
//! * **JavaScript → Android**: JS calls are routed directly to the Kotlin `@Command` methods.
//!
//!   ```js
//!   await invoke('plugin:media-notification|updateNotification', { ... });
//!   await invoke('plugin:media-notification|updateProgress',    { ... });
//!   await invoke('plugin:media-notification|hideNotification',  {});
//!   ```
//!
//! * **Android → JavaScript**: media-button / notification events are delivered as Tauri
//!   plugin events.  Listen with:
//!
//!   ```js
//!   await listen('plugin:media-notification:mediaAction', ({ payload }) => {
//!     // payload.action   : 'play' | 'pause' | 'next' | 'previous' | 'stop' | 'seek'
//!     // payload.position : number | undefined   (seek target, ms)
//!   });
//!   ```
//!
//! * **Rust → Android**: other Rust code can drive the notification through
//!   [`MediaNotificationHandle`] stored in Tauri app state.
//!
//!   ```rust
//!   let handle = app.state::<MediaNotificationHandle<R>>();
//!   handle.update_notification(&req)?;
//!   ```
//!
//! On non-Android targets the plugin is compiled as an **no-op** so the same `lib.rs`
//! compiles for desktop without any conditional compilation at the call site.

use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;

// ═══════════════════════════════════════════════════════════════════════════════
// Data types
// ═══════════════════════════════════════════════════════════════════════════════

/// Full metadata + playback-state update sent to `updateNotification`.
///
/// Field names are serialised as **camelCase** to match the Kotlin `@Command` argument
/// names (`title`, `artist`, `album`, `isPlaying`, `position`, `duration`, `artworkUrl`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaSessionRequest {
    /// Track title shown as the notification content title.
    pub title: String,
    /// Primary artist string shown as the notification content text.
    pub artist: String,
    /// Album name shown as the notification sub-text.
    pub album: String,
    /// Total track duration in **milliseconds**.
    pub duration: u64,
    /// Current playback position in **milliseconds**.
    pub position: u64,
    /// Whether the player is currently playing (controls the play/pause icon).
    pub is_playing: bool,
    /// HTTP/HTTPS URL of the album artwork.  The Kotlin side fetches and caches the bitmap.
    /// Pass an empty string to keep the previous artwork.
    pub artwork_url: String,
}

/// Lightweight position + playing-state update sent to `updateProgress`.
///
/// Use this for frequent tick updates (e.g. every second) so that the notification
/// progress indicator and `MediaSession` stay in sync without re-fetching artwork.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgressRequest {
    /// Current playback position in **milliseconds**.
    pub position: u64,
    /// Whether the player is currently playing.
    pub is_playing: bool,
}

/// Event payload pushed from Kotlin via `trigger("mediaAction", payload)`.
///
/// Received in JavaScript as the payload of a
/// `'plugin:media-notification:mediaAction'` event.
///
/// This type is intentionally **not** used on the command-dispatch path; it exists
/// so that Rust code that needs to *produce* or *inspect* these events has a
/// well-typed representation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaActionEvent {
    /// Media control action triggered by a hardware button, notification button, or
    /// another app (e.g. Bluetooth headset).
    ///
    /// One of: `"play"`, `"pause"`, `"next"`, `"previous"`, `"stop"`, `"seek"`.
    pub action: String,
    /// Seek target in **milliseconds**.  Only present when `action == "seek"`.
    pub position: Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Android plugin handle
// ═══════════════════════════════════════════════════════════════════════════════

/// Rust-side wrapper around the registered Android `MediaNotification` Kotlin plugin.
///
/// Stored in Tauri app state after [`init`] runs.  Retrieve with:
///
/// ```rust
/// let handle = app.state::<MediaNotificationHandle<R>>();
/// handle.update_notification(&req)?;
/// ```
///
/// Only compiled on Android; other platforms expose an equivalent zero-sized type so
/// that generic code that stores state can compile everywhere.
#[cfg(target_os = "android")]
pub struct MediaNotificationHandle<R: Runtime>(PluginHandle<R>);

/// No-op placeholder so that state-management code compiles on non-Android targets.
#[cfg(not(target_os = "android"))]
pub struct MediaNotificationHandle<R: Runtime>(std::marker::PhantomData<R>);

// ── Android implementation ────────────────────────────────────────────────────

#[cfg(target_os = "android")]
impl<R: Runtime> MediaNotificationHandle<R> {
    /// Push a full metadata + playback-state update to the Android notification.
    ///
    /// This is the heavyweight call — use it when the song changes or the cover art URL
    /// changes.  For frequent position ticks prefer [`update_progress`].
    pub fn update_notification(&self, req: &MediaSessionRequest) -> tauri::Result<()> {
        Ok(self.0.run_mobile_plugin::<()>("updateNotification", req)?)
    }

    /// Lightweight position + playing-state update (metadata and artwork unchanged).
    ///
    /// Intended to be called roughly once per second while the player is active.
    pub fn update_progress(&self, req: &UpdateProgressRequest) -> tauri::Result<()> {
        Ok(self.0.run_mobile_plugin::<()>("updateProgress", req)?)
    }

    /// Dismiss the system notification and stop the foreground `MediaPlaybackService`.
    pub fn hide_notification(&self) -> tauri::Result<()> {
        Ok(self.0.run_mobile_plugin::<()>("hideNotification", ())?)
    }
}

// ── Non-Android no-ops ────────────────────────────────────────────────────────

#[cfg(not(target_os = "android"))]
impl<R: Runtime> MediaNotificationHandle<R> {
    /// No-op on non-Android platforms.
    #[inline(always)]
    pub fn update_notification(&self, _req: &MediaSessionRequest) -> tauri::Result<()> {
        Ok(())
    }

    /// No-op on non-Android platforms.
    #[inline(always)]
    pub fn update_progress(&self, _req: &UpdateProgressRequest) -> tauri::Result<()> {
        Ok(())
    }

    /// No-op on non-Android platforms.
    #[inline(always)]
    pub fn hide_notification(&self) -> tauri::Result<()> {
        Ok(())
    }
}

// Safety: PluginHandle<R> is Send + Sync; PhantomData<R> is Send + Sync when R is.
unsafe impl<R: Runtime + Send> Send for MediaNotificationHandle<R> {}
unsafe impl<R: Runtime + Sync> Sync for MediaNotificationHandle<R> {}

// ═══════════════════════════════════════════════════════════════════════════════
// Plugin init
// ═══════════════════════════════════════════════════════════════════════════════

/// Build the Tauri plugin that bridges to the Android `MediaNotification` Kotlin class.
///
/// On Android this registers the Kotlin plugin and stores a [`MediaNotificationHandle`]
/// in app state.  On all other platforms the plugin is a no-op so the same `run()`
/// function can be used unconditionally.
///
/// # Registration
///
/// ```rust
/// tauri::Builder::default()
///     .plugin(media_session::init())
///     // …
/// ```
///
/// # JavaScript commands
///
/// | JS call                                          | Kotlin `@Command`     |
/// |--------------------------------------------------|-----------------------|
/// | `invoke('plugin:media-notification\|updateNotification', req)` | `updateNotification` |
/// | `invoke('plugin:media-notification\|updateProgress', req)`     | `updateProgress`     |
/// | `invoke('plugin:media-notification\|hideNotification', {})`    | `hideNotification`   |
///
/// # JavaScript events
///
/// | `listen(…)` event name                              | Kotlin trigger              |
/// |-----------------------------------------------------|-----------------------------|
/// | `'plugin:media-notification:mediaAction'`           | `trigger("mediaAction", …)` |
pub fn init<R: Runtime + Send + Sync>() -> TauriPlugin<R> {
    Builder::new("media-notification")
        .setup(|app, mut api| {
            #[cfg(target_os = "android")]
            {
                let handle =
                    api.register_android_plugin("com.gbclstudio.gmplayer", "MediaNotification")?;
                app.manage(MediaNotificationHandle::<R>(handle));
            }

            // On non-Android targets the plugin is a no-op.
            // We still store a PhantomData handle so state look-ups compile everywhere.
            #[cfg(not(target_os = "android"))]
            {
                let _ = &mut api;
                app.manage(MediaNotificationHandle::<R>(std::marker::PhantomData));
            }

            Ok(())
        })
        .build()
}
