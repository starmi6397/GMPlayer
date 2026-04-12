/**
 * JS/TS bridge to the Android `media-notification` Tauri plugin.
 *
 * Architecture:
 *   JS  ──invoke──►  Rust plugin  ──JNI──►  Kotlin @Command   (commands)
 *   JS  ◄──listen──  Rust plugin  ◄──JNI──  Kotlin trigger()  (events)
 *
 * Plugin identifier : "media-notification"
 * Kotlin class      : com.gbclstudio.gmplayer.MediaNotification
 *
 * All exported functions are safe to call outside Tauri (browser / desktop):
 * they check `isTauri()` first and return silently if the environment is wrong.
 * The `invoke` call also fails-safe if the plugin is not available (e.g. iOS).
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./windowManager";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Full metadata + state payload for `updateNotification`.
 *
 * Field names are camelCase to match the Kotlin `@Command` argument names exactly.
 * Times are in **milliseconds** (Kotlin side uses `Long`).
 */
export interface MediaNotificationRequest {
  /** Track title shown as the notification's content title. */
  title: string;
  /** Primary artist string (artist names joined with ", "). */
  artist: string;
  /** Album name shown as the notification sub-text. */
  album: string;
  /** Whether the player is currently playing (controls the play/pause button icon). */
  isPlaying: boolean;
  /** Current playback position in **milliseconds**. */
  position: number;
  /** Total track duration in **milliseconds**. */
  duration: number;
  /**
   * HTTP/HTTPS URL for the album cover art.
   * The Kotlin side fetches and caches the bitmap; pass an empty string to
   * keep the previously displayed artwork.
   */
  artworkUrl: string;
}

/**
 * Lightweight position + playing-state payload for `updateProgress`.
 *
 * Use this for play/pause toggles and seek events so the notification's
 * `MediaSession` state stays in sync without re-fetching artwork.
 */
export interface UpdateProgressRequest {
  /** Whether the player is currently playing. */
  isPlaying: boolean;
  /** Current playback position in **milliseconds**. */
  position: number;
}

/**
 * Event payload pushed from Kotlin via `trigger("mediaAction", payload)`.
 *
 * Received in JavaScript as the payload of the
 * `"plugin:media-notification:mediaAction"` Tauri event.
 *
 * The `action` field identifies the control that was activated:
 * - `"play"` / `"pause"` — notification play/pause button or hardware key
 * - `"next"` / `"previous"` — skip buttons
 * - `"stop"` — stop action (e.g. swiping away the notification)
 * - `"seek"` — MediaSession seek-to; `position` (ms) is set
 */
export interface MediaActionPayload {
  action: "play" | "pause" | "next" | "previous" | "stop" | "seek";
  /** Seek target in **milliseconds** — only present when `action === "seek"`. */
  position?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Internal helpers
// ═══════════════════════════════════════════════════════════════════════════════

/** Tauri plugin command prefix. */
const PLUGIN = "plugin:media-notification";

/**
 * Invoke a plugin command with graceful degradation.
 *
 * - Returns `undefined` and logs a warning when the call fails (plugin not
 *   available, non-Android build, etc.).
 * - Returns `undefined` immediately when not running inside Tauri.
 */
async function call<T = void>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T | undefined> {
  if (!isTauri()) return undefined;
  try {
    return await invoke<T>(`${PLUGIN}|${command}`, args ?? {});
  } catch (err) {
    // Expected on non-Android Tauri builds (iOS, desktop) — log as warning,
    // not error, because this is not a bug from the caller's perspective.
    console.warn(`[MediaNotification] invoke "${command}" failed:`, err);
    return undefined;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Commands  (JS → Android)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Push a full metadata + playback-state update to the Android system notification
 * and `MediaSession`.
 *
 * This is the **heavyweight** call because the Kotlin side may need to fetch the
 * cover art bitmap over the network.  Call it when:
 * - A new track starts playing.
 * - The cover art URL changes.
 *
 * For frequent position ticks or play/pause toggling, prefer
 * {@link updateMediaProgress} to avoid redundant bitmap fetches.
 *
 * @example
 * ```ts
 * await updateMediaNotification({
 *   title: 'Song Name',
 *   artist: 'Artist A, Artist B',
 *   album: 'Album Title',
 *   isPlaying: true,
 *   position: 12_000,   // 12 s
 *   duration: 240_000,  // 4 min
 *   artworkUrl: 'https://example.com/cover.jpg?param=256y256',
 * });
 * ```
 */
export function updateMediaNotification(
  req: MediaNotificationRequest,
): Promise<void | undefined> {
  return call("updateNotification", req as unknown as Record<string, unknown>);
}

/**
 * Lightweight position + playing-state update.
 *
 * The Kotlin plugin maintains its own 1-second position ticker, so this does
 * **not** need to be called on every time tick.  Call it when:
 * - The play/pause state changes.
 * - The user seeks to a new position.
 * - The app returns to the foreground after a period of inactivity.
 *
 * @example
 * ```ts
 * await updateMediaProgress({ isPlaying: false, position: 34_500 });
 * ```
 */
export function updateMediaProgress(
  req: UpdateProgressRequest,
): Promise<void | undefined> {
  return call("updateProgress", req as unknown as Record<string, unknown>);
}

/**
 * Dismiss the system notification and stop the `MediaPlaybackService`
 * foreground service.
 *
 * **Important**: do *not* call this when the app merely goes to the background —
 * the notification must persist so that lock-screen / Bluetooth controls
 * continue working.  Call it only when playback is definitively stopped:
 * - The playlist becomes empty.
 * - The user explicitly quits.
 * - The component that hosts the player is destroyed.
 *
 * @example
 * ```ts
 * await hideMediaNotification();
 * ```
 */
export function hideMediaNotification(): Promise<void | undefined> {
  return call("hideNotification");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Events  (Android → JS)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Subscribe to media control actions emitted by the Android notification panel,
 * lock screen, or hardware media keys.
 *
 * Internally this is equivalent to
 * `listen("plugin:media-notification:mediaAction", handler)` — the Tauri event
 * that the Kotlin `trigger("mediaAction", payload)` call delivers to the WebView.
 *
 * @param handler - Callback invoked with the {@link MediaActionPayload} whenever
 *   the user interacts with a media control.
 * @returns A promise that resolves to an **unlisten function**.  Call it in
 *   `onUnmounted` or any other cleanup path to prevent memory leaks.
 *
 * @example
 * ```ts
 * const unlisten = await listenMediaAction(({ action, position }) => {
 *   if (action === 'play')  music.setPlayState(true);
 *   if (action === 'pause') music.setPlayState(false);
 *   if (action === 'next')  music.setPlaySongIndex('next');
 *   if (action === 'seek' && position !== undefined) setSeek($player, position / 1000);
 * });
 *
 * // Later, in onUnmounted:
 * unlisten();
 * ```
 */
export async function listenMediaAction(
  handler: (payload: MediaActionPayload) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};

  const tauri = window.__TAURI__;
  if (!tauri?.event) return () => {};

  try {
    // Plugin events from Kotlin `trigger("eventName", data)` arrive as
    // "plugin:<pluginName>:<eventName>" in the Tauri event system.
    const unlisten = await tauri.event.listen<MediaActionPayload>(
      `${PLUGIN}:mediaAction`,
      (event) => handler(event.payload),
    );
    return unlisten;
  } catch (err) {
    console.warn("[MediaNotification] listenMediaAction failed:", err);
    return () => {};
  }
}
