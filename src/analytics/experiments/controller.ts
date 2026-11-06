import type {Analytics, StorageLike} from '../datalayer.ts';
import {EXPERIMENT, type Variant, type ExperimentCounts} from './analysis.ts';
export const STATE_KEY = 'lifeos-experiment-task-entry-v1';
export const WINDOW_MS = 24 * 60 * 60 * 1000;
export interface ExperimentStorage extends StorageLike { removeItem(key: string): void }
interface State { id: string; exposure?: number; outcome?: number }
export interface ExperimentEnv {
  consent: Pick<Analytics, 'consent' | 'onConsent'>;
  storage: ExperimentStorage | null;
  enabled: boolean;
  now?: () => number;
  newId?: () => string;
  changed?: () => void;
}
/** SHA-256's first 32 bits map an experiment-specific anonymous browser ID to
 * an equal split. No user name, email, account ID or workspace content is used. */
export async function bucket(id: string): Promise<Variant> {
  if (!id) throw Error('A nonempty anonymous id is required.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${EXPERIMENT}:${id}`));
  return new DataView(digest).getUint32(0, false) < 0x80000000 ? 'control' : 'treatment';
}
export async function createExperiment(env: ExperimentEnv) {
  const now = env.now ?? Date.now, newId = env.newId ?? (() => crypto.randomUUID());
  let state: State | null = null, variant: Variant = 'control', generation = 0;
  const allowed = () => env.enabled && env.consent.consent() === 'granted';
  const persist = () => {try {if (state) env.storage?.setItem(STATE_KEY, JSON.stringify(state));} catch { /* in-memory only */ }};
  async function sync() {
    const turn = ++generation;
    state = null; variant = 'control';
    if (!allowed()) {
      // Withdrawal erases the local identifier and event log as well.
      try {env.storage?.removeItem(STATE_KEY);} catch { /* unavailable storage */ }
      env.changed?.();
      return;
    }
    let saved: State | null = null;
    try {
      const raw = JSON.parse(env.storage?.getItem(STATE_KEY) ?? 'null');
      if (raw && typeof raw.id === 'string' && raw.id.length <= 100 && raw.id.length > 0 &&
          (raw.exposure === undefined || Number.isFinite(raw.exposure)) &&
          (raw.outcome === undefined || (Number.isFinite(raw.outcome) && raw.exposure !== undefined && raw.outcome >= raw.exposure && raw.outcome <= raw.exposure + WINDOW_MS))) {
        saved = {id: raw.id, ...(raw.exposure !== undefined ? {exposure: raw.exposure} : {}), ...(raw.outcome !== undefined ? {outcome: raw.outcome} : {})};
      }
    } catch { /* Ignore malformed data. */ }
    const next = saved ?? {id: newId()};
    const assigned = await bucket(next.id);
    if (turn !== generation || !allowed()) return;
    state = next; variant = assigned; persist(); env.changed?.();
  }
  const stop = env.consent.onConsent(() => {void sync().catch(() => {});});
  try {await sync();} catch (error) {stop(); throw error;}
  return {
    refresh: sync,
    variant: () => allowed() && state ? variant : 'control',
    label: () => allowed() && state && variant === 'treatment' ? 'Plan a task' : 'New task',
    expose() {
      if (!allowed() || !state || state.exposure !== undefined) return false;
      state.exposure = now(); persist(); return true;
    },
    /** Capture eligibility before the save starts. A consent change in flight
     * invalidates it; successful unrelated/pre-exposure writes cannot convert. */
    beginOutcome() {
      const turn = generation, eligible = allowed() && state?.exposure !== undefined;
      return (success: boolean) => {
        if (!success || !eligible || turn !== generation || !allowed() || !state || state.exposure === undefined || state.outcome !== undefined || now() < state.exposure || now() > state.exposure + WINDOW_MS) return false;
        state.outcome = now(); persist(); return true;
      };
    },
    counts(): ExperimentCounts {
      const counts: ExperimentCounts = {experiment: EXPERIMENT, control: {exposures: 0, conversions: 0}, treatment: {exposures: 0, conversions: 0}};
      if (allowed() && state) counts[variant] = {exposures: Number(state.exposure !== undefined), conversions: Number(state.outcome !== undefined)};
      return counts;
    },
    stop() {++generation; stop();}
  };
}
export type Experiment = Awaited<ReturnType<typeof createExperiment>>;
