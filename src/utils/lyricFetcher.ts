import { getUnifiedLyric } from "@/api/song";
import { parseLyricData, formatAsLrc } from "@/utils/LyricsProcessor";
import type { ParsedLyricResult } from "@/utils/LyricsProcessor";
import useSettingDataStore from "@/store/settingData";

const MAX_CACHE_SIZE = 50;

interface CacheEntry {
  result: ParsedLyricResult;
  useTTMLRepo: boolean;
}

class LyricFetcher {
  /** LRU cache: songId → parsed result */
  private _cache = new Map<number, CacheEntry>();

  /** Currently in-flight promises (dedup same-id concurrent calls) */
  private _pending = new Map<number, Promise<ParsedLyricResult>>();

  /** Monotonic counter — only the latest call's result gets applied */
  private _generation = 0;

  /**
   * Fetch, parse, and cache lyrics for a song.
   * Returns `{ result, stale }`:
   *   - `result`: the parsed lyric data (from cache or network)
   *   - `stale`: true if a newer fetchLyric() call was made while this one was in-flight
   */
  async fetchLyric(id: number): Promise<{ result: ParsedLyricResult; stale: boolean }> {
    const generation = ++this._generation;
    const settingStore = useSettingDataStore();
    const useTTMLRepo = settingStore.useTTMLRepo;

    // 1. Cache hit (setting must match)
    const cached = this._cache.get(id);
    if (cached && cached.useTTMLRepo === useTTMLRepo) {
      // LRU touch: delete + re-insert to move to end
      this._cache.delete(id);
      this._cache.set(id, cached);
      return { result: cached.result, stale: generation !== this._generation };
    }

    // 2. In-flight dedup: if the same id is already being fetched, reuse its promise
    const pending = this._pending.get(id);
    if (pending) {
      const result = await pending;
      return { result, stale: generation !== this._generation };
    }

    // 3. Network fetch + parse
    const promise = this._doFetch(id, useTTMLRepo);
    this._pending.set(id, promise);

    try {
      const result = await promise;

      // Cache the result (evict oldest if over limit)
      if (this._cache.size >= MAX_CACHE_SIZE) {
        const oldest = this._cache.keys().next().value;
        if (oldest !== undefined) {
          this._cache.delete(oldest);
        }
      }
      this._cache.set(id, { result, useTTMLRepo });

      return { result, stale: generation !== this._generation };
    } finally {
      this._pending.delete(id);
    }
  }

  private async _doFetch(id: number, useTTMLRepo: boolean): Promise<ParsedLyricResult> {
    const lyricData = await getUnifiedLyric(id, useTTMLRepo);
    const parsedResult = parseLyricData(lyricData);
    parsedResult.formattedLrc = formatAsLrc(parsedResult);
    return parsedResult;
  }

  /** Invalidate a specific song's cached lyrics */
  invalidate(id: number): void {
    this._cache.delete(id);
  }

  /** Clear entire cache */
  clear(): void {
    this._cache.clear();
  }
}

/** Singleton */
export const lyricFetcher = new LyricFetcher();
