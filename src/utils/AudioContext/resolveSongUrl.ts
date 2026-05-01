/**
 * resolveSongUrl — Unified song URL resolution with NCM + UNM fallback.
 *
 * Consolidates the duplicated URL resolution logic from:
 * - Player/index.vue (getPlaySongData + getMusicNumUrlData)
 * - AudioPreloader.ts (_resolveAndPreload)
 * - PreBufferManager.ts (doPreBuffer)
 * - musicData.ts (preloadUpcomingSongs)
 *
 * Handles: quality level, VIP pre-check, trial version detection,
 * UNM fallback, and kuwo proxy URL.
 */

import { getMusicUrl, getMusicNumUrl } from "@/api/song";
import type { MusicLevel } from "@/api/types";
import useSettingDataStore from "@/store/settingData";

const IS_DEV = import.meta.env?.DEV ?? false;
const useUnmServerHas = !!import.meta.env.VITE_UNM_API;

export interface SongUrlInput {
  id: number;
  fee?: number;
  pc?: any;
  name?: string;
}

export interface ResolveSongUrlResult {
  url: string;
  source: "ncm" | "unm";
}

export interface ResolveSongUrlOptions {
  signal?: AbortSignal;
}

/**
 * Resolve a playable URL for a song via NCM official API, with UNM fallback.
 *
 * @param song  - Song metadata (id required; fee/pc used for VIP detection)
 * @param level - Quality level (defaults to store setting or "exhigh")
 * @param options - Optional AbortSignal for cancellation
 * @returns `{ url, source }` or `null` if no URL could be resolved
 */
export async function resolveSongUrl(
  song: SongUrlInput,
  level?: MusicLevel | string,
  options?: ResolveSongUrlOptions,
): Promise<ResolveSongUrlResult | null> {
  const signal = options?.signal;
  const logPrefix = `[resolveSongUrl] ${song.name ?? song.id}`;

  // Resolve effective level
  const settingStore = useSettingDataStore();
  const effectiveLevel = (level || settingStore.songLevel || "exhigh") as MusicLevel;
  const unmEnabled = useUnmServerHas && settingStore.useUnmServer;

  // VIP pre-check: fee=1 (VIP) or fee=4 (paid album), no PC (cloud-uploaded) bypass
  if (unmEnabled && !song.pc && (song.fee === 1 || song.fee === 4)) {
    if (IS_DEV) {
      console.log(`${logPrefix}: VIP/paid song, going directly to UNM`);
    }
    return resolveViaUnm(song.id, logPrefix, signal);
  }

  // Step 1: Try NCM official API
  let url: string | null = null;
  try {
    const res = await getMusicUrl(song.id, effectiveLevel);
    if (signal?.aborted) return null;

    const rawUrl = res?.data?.[0]?.url;
    if (rawUrl) {
      url = rawUrl.replace(/^http:/, "https:");

      // Trial version detection (jd-musicrep-ts = trial/preview clip)
      if (url.includes("jd-musicrep-ts")) {
        if (IS_DEV) {
          console.log(`${logPrefix}: trial version detected, nullifying NCM URL`);
        }
        url = null;
      }
    }
  } catch (err) {
    if (signal?.aborted) return null;
    if (IS_DEV) {
      console.warn(`${logPrefix}: getMusicUrl failed`, err);
    }
    url = null;
  }

  if (signal?.aborted) return null;

  // Step 2: If NCM succeeded, return it
  if (url) {
    return { url, source: "ncm" };
  }

  // Step 3: UNM fallback
  if (unmEnabled) {
    if (IS_DEV) {
      console.log(`${logPrefix}: no NCM URL, trying UNM fallback`);
    }
    return resolveViaUnm(song.id, logPrefix, signal);
  }

  if (IS_DEV) {
    console.warn(`${logPrefix}: no URL resolved (UNM disabled)`);
  }
  return null;
}

/**
 * Resolve URL via UNM (UnblockNeteaseMusic) API, handling kuwo proxy.
 */
async function resolveViaUnm(
  id: number,
  logPrefix: string,
  signal?: AbortSignal,
): Promise<ResolveSongUrlResult | null> {
  try {
    const unmRes = await getMusicNumUrl(id);
    if (signal?.aborted) return null;

    if (unmRes?.code === 200 && unmRes?.data?.url) {
      let url: string = unmRes.data.url.replace(/^http:/, "https:");

      // kuwo.cn proxy handling: use proxyUrl if available
      if (/kuwo\.cn/i.test(url) && unmRes.data.proxyUrl) {
        url = unmRes.data.proxyUrl;
        if (IS_DEV) {
          console.log(`${logPrefix}: using kuwo proxy URL`);
        }
      }

      if (IS_DEV) {
        console.log(`${logPrefix}: resolved via UNM`);
      }
      return { url, source: "unm" };
    }
  } catch (err) {
    if (signal?.aborted) return null;
    if (IS_DEV) {
      console.warn(`${logPrefix}: UNM fallback failed`, err);
    }
  }
  return null;
}
