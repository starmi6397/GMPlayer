/**
 * Composable: useAndroidMediaSession
 *
 * Bridges the Vue player state with the Android `media-notification` Tauri plugin.
 *
 * Responsibilities:
 *   1. On mount — detect Tauri-mobile environment and initialize the plugin listener.
 *   2. Watchers — push state updates to the Android notification at the right granularity:
 *        • Song change  → full `updateMediaNotification` (metadata + artwork)
 *        • Duration available (audio loaded) → re-sync with correct duration
 *        • Play / pause → lightweight `updateMediaProgress`
 *        • Time ticks   → throttled drift correction (every 5 s)
 *   3. Media-action handler — routes Kotlin `trigger("mediaAction", …)` events back to
 *        the Pinia store so the in-app UI stays in sync with lock-screen controls.
 *   4. Visibility change — re-syncs position when the app returns to the foreground.
 *   5. On unmount — unsubscribes from events and hides the notification.
 *
 * Usage (call once from Player/index.vue <script setup>):
 *   ```ts
 *   import { useAndroidMediaSession } from "@/composables/useAndroidMediaSession";
 *   useAndroidMediaSession();
 *   ```
 */

import { ref, watch, onMounted, onUnmounted } from "vue";
import { debounce, throttle } from "throttle-debounce";
import { musicStore } from "@/store";
import { isTauri, isMobile } from "@/utils/tauri";
import { setSeek } from "@/utils/AudioContext";
import {
  updateMediaNotification,
  updateMediaProgress,
  hideMediaNotification,
  listenMediaAction,
  type MediaActionPayload,
} from "@/utils/tauri/mediaNotification";

// ─── Module-level singleton guard ─────────────────────────────────────────────
// Prevents double-registration if the component is hot-reloaded or mounted twice.
let _instanceCount = 0;

export function useAndroidMediaSession() {
  const music = musicStore();

  /**
   * Becomes `true` once we have confirmed the runtime is Tauri + mobile.
   * All watcher callbacks and sync functions bail out early when this is `false`
   * so they are truly zero-cost on desktop / browser builds.
   */
  const active = ref(false);

  /** Unlisten function returned by `listenMediaAction`. */
  let unlistenMediaAction: (() => void) | null = null;

  // ═══════════════════════════════════════════════════════════════════════════
  // Payload helpers
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Build the full notification payload from current store state.
   * Returns `null` when no song is loaded (notification should be hidden).
   */
  function buildFullPayload() {
    const song = music.getPlaySongData;
    if (!song) return null;

    // Use 256×256 artwork — large enough to look sharp on the lock screen,
    // small enough to download quickly over mobile data.
    const artworkUrl = song.album?.picUrl
      ? song.album.picUrl.replace(/^http:/, "https:") + "?param=256y256"
      : "";

    return {
      title: song.name || "",
      artist:
        Array.isArray(song.artist)
          ? song.artist.map((a: { name: string }) => a.name).join(", ")
          : "",
      album: song.album?.name || "",
      isPlaying: music.getPlayState,
      // Store keeps times in **seconds**; Kotlin expects **milliseconds**.
      position: Math.round((music.getPlaySongTime.currentTime || 0) * 1_000),
      duration: Math.round((music.getPlaySongTime.duration || 0) * 1_000),
      artworkUrl,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Sync functions
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Full notification update (metadata + artwork + state).
   *
   * Debounced 300 ms so rapid song-change events (e.g. AutoMix setup) are
   * collapsed into a single IPC call.  The Kotlin side may need to fetch a
   * bitmap over the network, so we don't want to hammer it.
   */
  const syncNotification = debounce(300, async () => {
    if (!active.value) return;

    const payload = buildFullPayload();
    if (payload) {
      await updateMediaNotification(payload);
    } else {
      // No song loaded — dismiss the notification.
      await hideMediaNotification();
    }
  });

  /**
   * Lightweight progress + playing-state update.
   *
   * Used for play/pause toggles and user-initiated seeks.  Does NOT re-fetch
   * artwork.
   */
  async function syncProgress(): Promise<void> {
    if (!active.value || !music.getPlaySongData) return;

    await updateMediaProgress({
      isPlaying: music.getPlayState,
      position: Math.round((music.getPlaySongTime.currentTime || 0) * 1_000),
    });
  }

  /**
   * Throttled position correction (max once per 5 s).
   *
   * The Kotlin plugin maintains its own 1-second ticker that increments the
   * stored position.  This correction keeps it from drifting relative to the
   * actual Web Audio playback position.
   */
  const syncProgressCorrected = throttle(5_000, syncProgress);

  // ═══════════════════════════════════════════════════════════════════════════
  // Media-action handler  (Android → JS)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handles `MediaActionPayload` events emitted by the Kotlin plugin when the
   * user interacts with the notification panel, lock screen, or hardware media
   * keys.
   *
   * Each action maps directly to an existing Pinia store operation so the
   * in-app UI re-renders automatically.
   */
  function handleMediaAction(payload: MediaActionPayload): void {
    console.log("[AndroidMediaSession] mediaAction →", payload.action, payload);

    switch (payload.action) {
      case "play":
        music.setPlayState(true);
        break;

      case "pause":
        music.setPlayState(false);
        break;

      case "next":
        music.setPlaySongIndex("next");
        break;

      case "previous":
        music.setPlaySongIndex("prev");
        break;

      case "stop":
        // The user swiped away the notification — pause and clean up.
        music.setPlayState(false);
        hideMediaNotification();
        break;

      case "seek":
        if (typeof payload.position === "number") {
          const seekSec = payload.position / 1_000;
          // Seek the actual audio source.
          if (window.$player) {
            setSeek(window.$player, seekSec);
          }
          // Keep the store's displayed time in sync immediately so the UI
          // updates without waiting for the next audio-time callback.
          music.setPlaySongTime({
            currentTime: seekSec,
            duration: music.getPlaySongTime.duration,
          });
          // Push the corrected position back to the Kotlin MediaSession so the
          // notification progress bar doesn't jump.
          syncProgress();
        }
        break;

      default:
        console.warn("[AndroidMediaSession] Unknown mediaAction:", payload.action);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Page-visibility handler  (foreground / background)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * When the app returns to the foreground, the Kotlin ticker position may have
   * drifted from the actual Web Audio playback position.  Re-sync immediately.
   */
  function onVisibilityChange(): void {
    if (!active.value) return;
    if (document.visibilityState === "visible") {
      console.log("[AndroidMediaSession] App foregrounded — syncing progress.");
      syncProgress();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Lifecycle
  // ═══════════════════════════════════════════════════════════════════════════

  onMounted(async () => {
    // Guard against double-registration from HMR / StrictMode.
    if (_instanceCount > 0) {
      console.warn("[AndroidMediaSession] Multiple instances detected — skipping setup.");
      return;
    }
    _instanceCount++;

    // Bail out immediately for non-Tauri environments (browser, dev server).
    if (!isTauri()) return;

    // `isMobile()` invokes the Rust `detect_desktop` command; result is cached
    // on the Rust side so this is cheap after the first call.
    active.value = await isMobile();
    if (!active.value) return;

    console.log("[AndroidMediaSession] Tauri mobile detected — setting up media session.");

    // Subscribe to media-control events from the notification panel.
    unlistenMediaAction = await listenMediaAction(handleMediaAction);

    // Subscribe to app foreground/background transitions.
    document.addEventListener("visibilitychange", onVisibilityChange);

    // Push the initial state in case a song was already playing when the
    // component mounted (e.g. app restarted with persisted playlist).
    syncNotification();
  });

  onUnmounted(() => {
    _instanceCount = Math.max(0, _instanceCount - 1);

    // Remove event subscriptions.
    unlistenMediaAction?.();
    unlistenMediaAction = null;
    document.removeEventListener("visibilitychange", onVisibilityChange);

    // Dismiss the notification when the player component is destroyed.
    // (This should only happen when the entire app tears down.)
    if (active.value) {
      hideMediaNotification();
    }

    active.value = false;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Watchers
  // ═══════════════════════════════════════════════════════════════════════════
  // All watchers check `active.value` first and are no-ops on non-mobile builds.

  /**
   * Song metadata changed → full notification update.
   *
   * Covers: new song selected, playlist changed, personal FM, AutoMix.
   */
  watch(
    () => music.getPlaySongData,
    (val) => {
      if (!active.value) return;
      if (val) {
        syncNotification();
      } else {
        hideMediaNotification();
      }
    },
    { deep: true },
  );

  /**
   * Duration became available (audio element finished loading metadata) →
   * re-sync so the notification displays the correct total track length.
   *
   * Without this watch the initial `syncNotification` call (fired immediately
   * on song change) often carries `duration = 0` because the audio hasn't
   * loaded yet.
   */
  watch(
    () => music.getPlaySongTime.duration,
    (val) => {
      if (!active.value || !val) return;
      // Duration just arrived — update without debounce so the notification
      // shows the correct total length as quickly as possible.
      syncNotification.cancel?.();
      syncNotification();
    },
  );

  /**
   * Play / pause state changed → update `isPlaying` flag in the notification.
   *
   * This toggles the play/pause button icon and starts/stops the Kotlin
   * position ticker.
   */
  watch(
    () => music.getPlayState,
    () => {
      if (!active.value) return;
      syncProgress();
    },
  );

  /**
   * Playback position tick → throttled drift correction.
   *
   * The Kotlin ticker increments the stored position by 1 000 ms every second.
   * This watch ensures the notification never drifts more than 5 s from the
   * actual Web Audio position.  Throttling prevents IPC call spam.
   */
  watch(
    () => music.getPlaySongTime.currentTime,
    () => {
      if (!active.value) return;
      syncProgressCorrected();
    },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Public API (exposed for manual override if needed)
  // ═══════════════════════════════════════════════════════════════════════════

  return {
    /** Force a full notification sync (metadata + artwork + state). */
    syncNotification,
    /** Force an immediate progress sync (position + isPlaying). */
    syncProgress,
  };
}
