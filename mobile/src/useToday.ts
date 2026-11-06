import {useCallback, useEffect, useRef, useState} from 'react';
import {AppState} from 'react-native';
import {nextLifeosDayAt} from '../../public/lifeos-day';
import type {FeedClient, Snapshot} from './feed';

export function useToday(client: FeedClient, clock: () => number) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [offline, setOffline] = useState(false);
  const [cacheSaved, setCacheSaved] = useState(true);
  const [now, setNow] = useState(clock);
  const mounted = useRef(false), busy = useRef(false), fresh = useRef(false);
  const pending = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const controller = new AbortController(); pending.current = controller;
    setRefreshing(true); setNow(clock());
    try {
      const result = await client.refresh(controller.signal);
      if (mounted.current && !controller.signal.aborted) {
        fresh.current = true; setSnapshot(result.snapshot); setCacheSaved(result.cacheSaved); setOffline(false);
      }
    } catch {
      if (mounted.current && !controller.signal.aborted) setOffline(true);
    } finally {
      if (pending.current === controller) {
        busy.current = false;
        if (mounted.current) setRefreshing(false);
      }
    }
  }, [client, clock]);
  useEffect(() => {
    mounted.current = true; fresh.current = false;
    let active = true;
    void client.readCache().then(cached => {if (active && !fresh.current && cached) setSnapshot(cached);});
    void refresh();
    const subscription = AppState.addEventListener('change', state => {if (state === 'active') void refresh();});
    return () => {active = false; mounted.current = false; pending.current?.abort(); busy.current = false; subscription.remove();};
  }, [client, refresh]);
  useEffect(() => {
    const boundary = nextLifeosDayAt(now, snapshot?.feed.timeZone ?? 'America/Toronto');
    const timer = setTimeout(() => {setNow(clock()); void refresh();}, Math.max(1, boundary - clock()));
    return () => clearTimeout(timer);
  }, [now, snapshot?.feed.timeZone, clock, refresh]);
  return {snapshot, refreshing, offline, cacheSaved, now, refresh};
}
