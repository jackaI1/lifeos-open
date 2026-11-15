import {ref, type Ref} from 'vue';
import {parseFeed} from '../../../../src/shared/today.ts';
import {buildWeek, type Week} from '../week.ts';

export type LoadState =
  | {status: 'loading'}
  | ({status: 'ready'} & Week)
  | {status: 'offline'; message: string}
  | {status: 'error'; message: string};

export interface WeekScheduleOptions {
  url?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  isOnline?: () => boolean;
}

/** Loads the demo feed and reports one of four states: loading, ready, offline or error. */
export function useWeekSchedule(options: WeekScheduleOptions = {}): {state: Ref<LoadState>; load: () => Promise<void>} {
  const {url = '/today.json', fetchImpl = fetch, now = () => Date.now(), isOnline = () => navigator.onLine} = options;
  const state = ref<LoadState>({status: 'loading'});
  async function load() {
    state.value = {status: 'loading'};
    if (!isOnline()) {
      state.value = {status: 'offline', message: 'You are offline. Connect to the internet and try again.'};
      return;
    }
    try {
      const response = await fetchImpl(url, {cache: 'no-store'});
      if (!response.ok) throw new Error(`status ${response.status}`);
      const feed = parseFeed(await response.json());
      state.value = {status: 'ready', ...buildWeek(feed, now())};
    } catch (error) {
      if (error instanceof TypeError) {
        state.value = {status: 'offline', message: 'The schedule could not be reached. Check your connection and try again.'};
      } else {
        state.value = {status: 'error', message: 'The schedule could not be read. Try again in a moment.'};
      }
    }
  }
  return {state, load};
}
