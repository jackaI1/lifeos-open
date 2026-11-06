import {readFileSync} from 'node:fs';
import {createFeedClient, CACHE_KEY, fetchDemoFeed} from '../src/feed';
const template = JSON.parse(readFileSync('../public/demo/today.json', 'utf8'));
const now = Date.parse('2026-11-05T16:00:00Z');
function setup() {
  let saved: string | null = null;
  const storage = {getItem: jest.fn(async () => saved), setItem: jest.fn(async (_key: string, value: string) => {saved = value;})};
  const download = jest.fn(async () => template);
  return {storage, download, client: createFeedClient({storage, download, now: () => now})};
}
test('a successful download persists resolved dates and survives an offline restart', async () => {
  const {client, download, storage} = setup();
  const fresh = await client.refresh();
  expect(fresh.snapshot.feed.anchorDate).toBe('2026-11-05');
  expect(storage.setItem).toHaveBeenCalledWith(CACHE_KEY, expect.any(String));
  download.mockRejectedValue(new Error('offline'));
  const restarted = createFeedClient({storage, download, now: () => now + 86400000});
  const cached = await restarted.readCache();
  expect(cached?.feed.anchorDate).toBe('2026-11-05');
  expect(cached?.savedAt).toBe(now);
  await expect(restarted.refresh()).rejects.toThrow('offline');
});
test('bad disk data is ignored so the network can still recover', async () => {
  const {storage, client} = setup();
  storage.getItem.mockResolvedValueOnce('{broken');
  expect(await client.readCache()).toBeNull();
  storage.getItem.mockRejectedValueOnce(new Error('disk'));
  expect(await client.readCache()).toBeNull();
  expect((await client.refresh()).snapshot.feed.fictional).toBe(true);
});
test('malformed responses do not replace the last good cache', async () => {
  const {client, download, storage} = setup();
  await client.refresh();
  download.mockResolvedValueOnce({fictional: false});
  await expect(client.refresh()).rejects.toThrow();
  expect(storage.setItem).toHaveBeenCalledTimes(1);
});
test('storage failure keeps fresh content but warns offline saving failed', async () => {
  const {client, storage} = setup();
  storage.setItem.mockRejectedValueOnce(new Error('disk full'));
  expect((await client.refresh()).cacheSaved).toBe(false);
});
test('fetch checks HTTP status and cancels a stalled request', async () => {
  const fetcher = jest.fn(async () => ({ok: false, status: 503} as Response));
  await expect(fetchDemoFeed('https://example.invalid/feed', {fetcher})).rejects.toThrow('503');
  jest.useFakeTimers();
  let signal: AbortSignal | null | undefined;
  const stalled = jest.fn((_url: Parameters<typeof fetch>[0], options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    signal = options?.signal;
    signal?.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  const result = fetchDemoFeed('https://example.invalid/feed', {fetcher: stalled, timeoutMs: 50});
  const assertion = expect(result).rejects.toThrow('aborted');
  await jest.advanceTimersByTimeAsync(51);
  await assertion;
  expect(signal?.aborted).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});
