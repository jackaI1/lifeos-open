import {describe, expect, it, vi} from 'vitest';
import {useWeekSchedule} from './useWeekSchedule';
import {feed} from '../fixtures';

const NOW = () => Date.parse('2026-10-06T16:00:00Z');
const okResponse = () => new Response(JSON.stringify(feed), {status: 200, headers: {'content-type': 'application/json'}});

describe('useWeekSchedule', () => {
  it('starts loading, then becomes ready with a week', async () => {
    const fetcher = vi.fn(async () => okResponse());
    const schedule = useWeekSchedule({fetcher, now: NOW, isOnline: () => true});
    expect(schedule.status.value).toBe('loading');
    await schedule.load();
    expect(schedule.status.value).toBe('ready');
    expect(schedule.week.value?.days).toHaveLength(7);
    expect(fetcher).toHaveBeenCalledWith('/demo/today.json', expect.objectContaining({cache: 'no-store'}));
  });

  it('reports offline without fetching when the browser says it is offline', async () => {
    const fetcher = vi.fn(async () => okResponse());
    const schedule = useWeekSchedule({fetcher, now: NOW, isOnline: () => false});
    await schedule.load();
    expect(schedule.status.value).toBe('offline');
    expect(schedule.message.value).toMatch(/offline/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('treats a network failure as offline and keeps the last week that loaded', async () => {
    let online = true;
    const fetcher = vi.fn(async () => {
      if (!online) throw new TypeError('Failed to fetch');
      return okResponse();
    });
    const schedule = useWeekSchedule({fetcher, now: NOW, isOnline: () => online});
    await schedule.load();
    const loaded = schedule.week.value;
    online = false;
    await schedule.load();
    expect(schedule.status.value).toBe('offline');
    expect(schedule.week.value).toBe(loaded);
  });

  it('reports an HTTP failure as an error with a message', async () => {
    const schedule = useWeekSchedule({fetcher: async () => new Response('nope', {status: 500}), now: NOW, isOnline: () => true});
    await schedule.load();
    expect(schedule.status.value).toBe('error');
    expect(schedule.message.value).toMatch(/could not be loaded/);
  });

  it('reports a feed that fails validation as an error, not as a crash', async () => {
    const bad = new Response(JSON.stringify({schemaVersion: 2}), {status: 200});
    const schedule = useWeekSchedule({fetcher: async () => bad, now: NOW, isOnline: () => true});
    await schedule.load();
    expect(schedule.status.value).toBe('error');
    expect(schedule.week.value).toBeNull();
  });
});
