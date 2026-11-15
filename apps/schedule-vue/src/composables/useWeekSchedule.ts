import {ref, shallowRef} from 'vue';
import {parseFeed} from '../../../../src/shared/today';
import {buildWeek} from '../week';
import type {LoadStatus, WeekSchedule} from '../types';

export interface WeekScheduleOptions {
  url?: string;
  now?: () => number;
  fetcher?: typeof fetch;
  isOnline?: () => boolean;
}

const OFFLINE = 'You are offline. The last week that loaded is shown.';
const FAILED = 'The schedule could not be loaded. Try again.';

/**
 * Loads the public demo feed and keeps the last good week in memory, so going offline
 * after a successful load still shows something. Nothing is written to storage.
 */
export function useWeekSchedule(options: WeekScheduleOptions = {}) {
  const url = options.url ?? '/demo/today.json';
  const now = options.now ?? (() => Date.now());
  const fetcher = options.fetcher ?? fetch;
  const isOnline = options.isOnline ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false);
  const status = ref<LoadStatus>('loading');
  const message = ref<string | null>(null);
  const week = shallowRef<WeekSchedule | null>(null);

  async function load(): Promise<void> {
    status.value = 'loading';
    message.value = null;
    if (!isOnline()) {
      status.value = 'offline';
      message.value = OFFLINE;
      return;
    }
    try {
      const response = await fetcher(url, {cache: 'no-store'});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const feed = parseFeed(await response.json());
      week.value = buildWeek(feed, now());
      status.value = 'ready';
    } catch (error) {
      // fetch rejects with a TypeError when the network is down. Other failures are real errors.
      if (error instanceof TypeError) {
        status.value = 'offline';
        message.value = OFFLINE;
      } else {
        status.value = 'error';
        message.value = FAILED;
      }
    }
  }

  return {status, message, week, load};
}
