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
 *        • Loading state → update playback state to reflect buffering
 *   3. Media-action handler — routes Kotlin `trigger("mediaAction", …)` events back to
 *        the Pinia store so the in-app UI stays in sync with lock-screen controls.
 *   4. Visibility change — re-syncs position when the app returns to the foreground.
 *   5. Audio focus handling — responds to audio focus changes from the system.
 *   6. Error handling — updates notification state when playback errors occur.
 *   7. On unmount — unsubscribes from events and hides the notification.
 *
 * Usage (call once from Player/index.vue <script setup>):
 *   ```ts
 *   import { useAndroidMediaSession } from "@/composables/useAndroidMediaSession";
 *   useAndroidMediaSession();
 *   ```
 */

import { ref, watch, onMounted, onUnmounted } from "vue";
import { debounce } from "throttle-debounce";
import { storeToRefs } from "pinia";
import { musicStore } from "@/store";
import { isTauri, isMobile } from "@/utils/tauri";
import { setSeek } from "@/utils/AudioContext";
import {
  updateMediaNotification,
  updateMediaProgress,
  updateMediaPlaybackState,
  hideMediaNotification,
  listenMediaAction,
  listenAudioFocusChange,
  type MediaActionPayload,
  type AudioFocusState,
} from "@/utils/tauri/mediaNotification";

// ─── Module-level singleton guard ─────────────────────────────────────────────
// Prevents double-registration if the component is hot-reloaded or mounted twice.
let _instanceCount = 0;

export function useAndroidMediaSession() {
  const music = musicStore();
  const { persistData } = storeToRefs(music);

  /**
   * Becomes `true` once we have confirmed the runtime is Tauri + mobile.
   * All watcher callbacks and sync functions bail out early when this is `false`
   * so they are truly zero-cost on desktop / browser builds.
   */
  const active = ref(false);

  /** Unlisten function returned by `listenMediaAction`. */
  let unlistenMediaAction: (() => void) | null = null;

  /** Unlisten function returned by `listenAudioFocusChange`. */
  let unlistenAudioFocus: (() => void) | null = null;

  /** Track last sent payload hash to avoid redundant IPC calls */
  let _lastPayloadHash = "";

  /** Track last progress sync timestamp */
  let _lastProgressSyncTime = 0;
  const PROGRESS_SYNC_INTERVAL = 5_000; // ms

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

    const playSongTime = persistData.value.playSongTime;

    return {
      title: song.name || "",
      artist:
        Array.isArray(song.artist)
          ? song.artist.map((a: { name: string }) => a.name).join(", ")
          : "",
      album: song.album?.name || "",
      isPlaying: music.getPlayState,
      position: Math.round((playSongTime?.currentTime || 0) * 1_000),
      duration: Math.round((playSongTime?.duration || 0) * 1_000),
      artworkUrl,
    };
  }

  /**
   * Compute a simple hash of the payload for deduplication.
   */
  function hashPayload(obj: Record<string, unknown>): string {
    return JSON.stringify(obj);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Core sync functions
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
    if (!payload) {
      await hideMediaNotification();
      return;
    }

    // Deduplication: skip if payload hasn't changed
    const hash = hashPayload(payload);
    if (hash === _lastPayloadHash) return;
    _lastPayloadHash = hash;

    await updateMediaNotification(payload);
  });

  /**
   * Immediate full notification update (no debounce).
   * Used for critical state changes like song switches where we need
   * the notification to update right away.
   */
  async function syncNotificationImmediate(): Promise<void> {
    if (!active.value) return;

    // Cancel any pending debounced call to avoid double-send
    syncNotification.cancel?.();

    const payload = buildFullPayload();
    if (payload) {
      _lastPayloadHash = hashPayload(payload);
      await updateMediaNotification(payload);
    } else {
      await hideMediaNotification();
    }
  }

  /**
   * Lightweight progress + playing-state update.
   *
   * Used for play/pause toggles and user-initiated seeks.
   * Does NOT re-fetch artwork.
   */
  async function syncProgress(): Promise<void> {
    if (!active.value || !music.getPlaySongData) return;

    const playSongTime = persistData.value.playSongTime;
    await updateMediaProgress({
      isPlaying: music.getPlayState,
      position: Math.round((playSongTime?.currentTime || 0) * 1_000),
    });

    _lastProgressSyncTime = Date.now();
  }

  /**
   * Update only the playback state (playing/paused/buffering).
   * Used when loading state changes to show buffering indicator.
   */
  async function syncPlaybackState(): Promise<void> {
    if (!active.value || !music.getPlaySongData) return;

    // Map internal state to MediaSession playback state
    let state: "playing" | "paused" | "buffering" = "paused";
    if (music.isLoadingSong) {
      state = "buffering";
    } else if (music.getPlayState) {
      state = "playing";
    }

    const playSongTime = persistData.value.playSongTime;
    await updateMediaPlaybackState({
      state,
      position: Math.round((playSongTime?.currentTime || 0) * 1_000),
    });
  }

  /**
   * Periodic position sync — called on every currentTime change but
   * enforces a minimum interval to prevent IPC spam.
   */
  function maybeSyncProgress(): void {
    if (!active.value) return;

    const now = Date.now();
    if (now - _lastProgressSyncTime < PROGRESS_SYNC_INTERVAL) return;

    syncProgress();
  }

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
          const currentDuration = persistData.value.playSongTime?.duration || 0;
          music.setPlaySongTime({
            currentTime: seekSec,
            duration: currentDuration,
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
  // Audio focus handler (Android → JS)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handles audio focus changes from the Android system.
   * When another app requests audio focus (e.g. phone call, voice message),
   * we should pause playback.
   */
  function handleAudioFocusChange(state: AudioFocusState): void {
    console.log("[AndroidMediaSession] audioFocusChange →", state);

    switch (state) {
      case "gain":
        // We regained audio focus — resume if we were playing
        if (music.getPlayState && window.$player && !window.$player.playing()) {
          music.setPlayState(true);
        }
        break;

      case "loss":
        // Permanent loss — pause playback
        if (music.getPlayState) {
          music.setPlayState(false);
        }
        break;

      case "loss_transient":
        // Temporary loss (e.g. phone call, notification sound) — pause
        if (music.getPlayState) {
          music.setPlayState(false);
        }
        break;

      case "loss_transient_can_duck":
        // Temporary loss but we can duck (lower volume)
        // For now, just lower volume to 20%
        if (music.getPlayState && window.$player) {
          // Store original volume if not already stored
          if (!window._originalVolumeBeforeDuck) {
            window._originalVolumeBeforeDuck = music.persistData.playVolume;
          }
          music.persistData.playVolume = Math.max(0.1, window._originalVolumeBeforeDuck * 0.2);
        }
        break;

      default:
        break;
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
      // Full sync to recover from any drift while in background
      syncNotificationImmediate();
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

    // Subscribe to audio focus changes
    unlistenAudioFocus = await listenAudioFocusChange(handleAudioFocusChange);

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
    unlistenAudioFocus?.();
    unlistenAudioFocus = null;
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
   * Uses immediate sync on song ID change to ensure the notification
   * shows the new song right away.
   */
  watch(
    () => music.getPlaySongData,
    (val, oldVal) => {
      if (!active.value) return;

      const isNewSong = val?.id !== oldVal?.id;
      if (isNewSong) {
        // Reset deduplication hash so the new song's metadata is always sent
        _lastPayloadHash = "";
        // Reset progress sync timer so the first position update goes through
        _lastProgressSyncTime = 0;
        // Use immediate sync for song changes — no debounce
        syncNotificationImmediate();
      } else {
        // Same song, metadata may have changed (e.g. liked status)
        // Use debounced sync to avoid hammering IPC
        syncNotification();
      }

      if (!val) {
        hideMediaNotification();
      }
    },
    { deep: true },
  );

  /**
   * Duration became available (audio element finished loading metadata) →
   * re-sync so the notification displays the correct total track length.
   *
   * This is critical because the initial song-change sync often carries
   * duration = 0 (audio hasn't loaded yet). When duration arrives we
   * must push it to the notification immediately.
   */
  watch(
    () => persistData.value.playSongTime?.duration,
    (val, oldVal) => {
      if (!active.value) return;
      // Only sync when duration transitions from 0/undefined to a real value
      if (val && !oldVal) {
        syncNotificationImmediate();
      }
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
   * Loading state changed → update playback state to show buffering.
   * When loading finishes (isLoadingSong → false), also trigger a
   * progress sync so the notification shows the current position.
   */
  watch(
    () => music.isLoadingSong,
    (isLoading) => {
      if (!active.value) return;
      syncPlaybackState();
      // When loading finishes, sync progress immediately so the notification
      // doesn't stay at the old position
      if (!isLoading) {
        syncProgress();
      }
    },
  );

  /**
   * Playback position tick → periodic drift correction.
   *
   * Uses a time-based gate (5s interval) instead of throttle to avoid
   * the "first call executes, rest ignored" behavior of throttle which
   * can cause missed updates after song changes.
   */
  watch(
    () => persistData.value.playSongTime?.currentTime,
    () => {
      if (!active.value) return;
      maybeSyncProgress();
    },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Public API (exposed for manual override if needed)
  // ═══════════════════════════════════════════════════════════════════════════

  return {
    /** Force a full notification sync (metadata + artwork + state). */
    syncNotification,
    /** Force an immediate full notification sync (no debounce). */
    syncNotificationImmediate,
    /** Force an immediate progress sync (position + isPlaying). */
    syncProgress,
    /** Force an immediate playback state sync (playing/paused/buffering). */
    syncPlaybackState,
    /** Whether the media session is active (Tauri mobile). */
    active,
  };
}
