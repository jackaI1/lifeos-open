import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {ShellContext} from '../context';
import type {FinanceSnapshot, Period} from './types';

export interface FinancesState {
  data: FinanceSnapshot | null;
  error: Error | null;
  loading: boolean;
  /** Re-fetch the current period. Resolves once the newest response is applied. */
  reload: () => Promise<void>;
}

/**
 * Loads GET /api/finances?period=… through the shell's authenticated request.
 * - Keeps the previous snapshot visible while a new period loads (no flash).
 * - Ignores out-of-order responses when the period changes quickly.
 * - Never sets state after the view unmounts.
 */
export function useFinances(ctx: ShellContext, period: Period): FinancesState {
  const [state, setState] = useState<Omit<FinancesState, 'reload'>>({data: null, error: null, loading: true});
  const generation = useRef(0);
  const live = useRef(true);
  // Dialog callbacks can outlive the render that opened them. Refresh the current
  // committed selection even when a write from an earlier period finishes later.
  const current = useRef({ctx, period});
  useLayoutEffect(() => {
    current.current = {ctx, period};
  }, [ctx, period]);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    if (!live.current) return;
    const {ctx, period} = current.current;
    const id = ++generation.current;
    setState(s => ({...s, loading: true}));
    try {
      const data = await ctx.request<FinanceSnapshot>('/api/finances?period=' + period);
      if (live.current && id === generation.current) setState({data, error: null, loading: false});
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      if (live.current && id === generation.current) setState(s => ({...s, error, loading: false}));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, ctx, period]);

  return {...state, reload};
}
