import AsyncStorage from '@react-native-async-storage/async-storage';
import {parseFeed, resolveDemoFeed, type TodayFeed} from '../../src/shared/today';

export const DEMO_FEED_URL = process.env.EXPO_PUBLIC_DEMO_FEED_URL || 'https://raw.githubusercontent.com/jackaI1/lifeos-open/main/public/demo/today.json';
export const CACHE_KEY = 'lifeos-public-today-v1:' + DEMO_FEED_URL;
export interface Snapshot {feed: TodayFeed; savedAt: number}
interface Storage {getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>}

export async function fetchDemoFeed(url = DEMO_FEED_URL, {fetcher = fetch, timeoutMs = 10000, signal}: {fetcher?: typeof fetch; timeoutMs?: number; signal?: AbortSignal} = {}): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort);
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetcher(url, {signal: controller.signal, cache: 'no-store', credentials: 'omit'});
    if (!response.ok) throw new Error(`Demo feed returned ${response.status}`);
    const body = await response.text();
    if (body.length > 500000) throw new Error('Demo feed is too large');
    return JSON.parse(body);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export function createFeedClient({storage = AsyncStorage, download = (signal?: AbortSignal) => fetchDemoFeed(DEMO_FEED_URL, {signal}), now = Date.now}: {storage?: Storage; download?: (signal?: AbortSignal) => Promise<unknown>; now?: () => number} = {}) {
  return {
    async readCache(): Promise<Snapshot | null> {
      try {
        const raw = await storage.getItem(CACHE_KEY);
        if (!raw || raw.length > 500000) return null;
        const cached = JSON.parse(raw);
        if (typeof cached.savedAt !== 'number' || !Number.isFinite(cached.savedAt) || cached.savedAt < 0 || cached.savedAt > now() + 60000) return null;
        return {feed: parseFeed(cached.feed), savedAt: cached.savedAt};
      } catch {return null;}
    },
    async refresh(signal?: AbortSignal): Promise<{snapshot: Snapshot; cacheSaved: boolean}> {
      const input = parseFeed(await download(signal));
      if (signal?.aborted) throw new Error('Cancelled');
      const savedAt = now();
      const snapshot = {feed: resolveDemoFeed(input, savedAt), savedAt};
      try {await storage.setItem(CACHE_KEY, JSON.stringify(snapshot)); return {snapshot, cacheSaved: true};}
      catch {return {snapshot, cacheSaved: false};}
    },
  };
}
export type FeedClient = ReturnType<typeof createFeedClient>;
