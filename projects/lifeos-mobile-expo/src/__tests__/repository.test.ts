import feed from '../../public/lifeos-demo.json';
import { createRepository, CACHE_KEY } from '../repository';
import { resolveFeed } from '../dates';

const now = new Date(2026, 10, 5, 9);
const response = (value: unknown = feed, ok = true) => ({ ok, json: async () => value }) as Response;
const memory = () => {
  const data = new Map<string, string>();
  return { data, getItem: async (key: string) => data.get(key) ?? null,
    setItem: async (key: string, value: string) => { data.set(key, value); } };
};

test('persists a fetched snapshot and restores the same absolute dates after a restart', async () => {
  const storage = memory();
  const repo = createRepository({ storage, fetcher: async () => response(), now: () => now });
  const { snapshot, persisted } = await repo.refresh();
  expect(persisted).toBe(true);
  expect(JSON.parse(storage.data.get(CACHE_KEY)!)).toEqual(snapshot);
  const restarted = createRepository({ storage, fetcher: async () => { throw Error('offline'); } });
  expect(await restarted.read()).toEqual(snapshot);
  await expect(restarted.refresh()).rejects.toThrow('offline');
  expect(await restarted.read()).toEqual(snapshot);
});

test.each(['not json', '{"version":9}', JSON.stringify({ version: 1, fetchedAt: 'bad' })])('ignores corrupt cache safely', async value => {
  const storage = memory();
  storage.data.set(CACHE_KEY, value);
  expect(await createRepository({ storage }).read()).toBeNull();
});

test('rejects an impossible calendar date in the cache', async () => {
  const storage = memory();
  const snapshot = resolveFeed(feed, now);
  snapshot.deadlines[0]!.dueDate = '2026-02-30';
  storage.data.set(CACHE_KEY, JSON.stringify(snapshot));
  expect(await createRepository({ storage }).read()).toBeNull();
});

test.each([response(feed, false), response({ version: 9 }), response({})])('preserves the last snapshot after a bad response', async result => {
  const storage = memory();
  const saved = JSON.stringify(resolveFeed(feed, now));
  storage.data.set(CACHE_KEY, saved);
  const repo = createRepository({ storage, fetcher: async () => result });
  await expect(repo.refresh()).rejects.toThrow();
  expect(storage.data.get(CACHE_KEY)).toBe(saved);
});

test('returns fresh data with a warning when device storage cannot save', async () => {
  const storage = { getItem: async () => { throw Error('disk'); }, setItem: async () => { throw Error('disk'); } };
  const repo = createRepository({ storage, fetcher: async () => response(), now: () => now });
  expect(await repo.read()).toBeNull();
  const result = await repo.refresh();
  expect(result.persisted).toBe(false);
  expect(result.snapshot.schedule[0]!.title).toBe('Workshop');
});

test('aborts a hung request after the deadline and allows a later retry', async () => {
  jest.useFakeTimers();
  try {
    const repo = createRepository({ storage: memory(), timeoutMs: 100, fetcher: async (_url, init) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(Error('timed out')))) });
    const result = repo.refresh();
    const assertion = expect(result).rejects.toThrow('timed out');
    await jest.advanceTimersByTimeAsync(101);
    await assertion;
  } finally { jest.useRealTimers(); }
});

test('passes cancellation to an active network request', async () => {
  const controller = new AbortController();
  const repo = createRepository({ storage: memory(), fetcher: async (_url, init) =>
    new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(Error('cancelled')))) });
  const pending = repo.refresh(controller.signal);
  controller.abort();
  await expect(pending).rejects.toThrow('cancelled');
});
