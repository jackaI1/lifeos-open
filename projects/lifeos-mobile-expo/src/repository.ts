import { resolveFeed } from './dates';
import { parseSnapshot, Snapshot } from './feed';

export const CACHE_KEY = 'lifeos-public-snapshot-v1';
export const FEED_URL = 'https://raw.githubusercontent.com/jackaI1/lifeos-mobile-expo/main/public/lifeos-demo.json';
export interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
}
export interface Repository {
  read(): Promise<Snapshot | null>;
  refresh(signal?: AbortSignal): Promise<{ snapshot: Snapshot; persisted: boolean }>;
}
interface Options {
  storage: Storage;
  fetcher?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
  url?: string;
}
export function createRepository({ storage, fetcher = fetch, now = () => new Date(), timeoutMs = 10000, url = FEED_URL }: Options): Repository {
  return {
    async read() {
      try {
        const raw = await storage.getItem(CACHE_KEY);
        return raw ? parseSnapshot(JSON.parse(raw)) : null;
      } catch { return null; }
    },
    async refresh(signal) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, timeoutMs);
      try {
        if (signal?.aborted) throw Error('Request cancelled');
        const response = await fetcher(url, { signal: controller.signal, cache: 'no-store', headers: { Accept: 'application/json' } });
        if (!response.ok) throw Error('Public feed unavailable');
        const snapshot = resolveFeed(await response.json(), now());
        if (controller.signal.aborted) throw Error('Request cancelled');
        let persisted = true;
        try { await storage.setItem(CACHE_KEY, JSON.stringify(snapshot)); }
        catch { persisted = false; }
        return { snapshot, persisted };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      }
    },
  };
}
