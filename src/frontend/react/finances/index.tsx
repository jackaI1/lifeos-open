/**
 * Entry point bundled to public/react/finances.mjs and loaded by
 * public/modules/finances.js. Implements the shell's view contract:
 * `mount(root, ctx)` resolves after the first load and returns `{destroy}`.
 */
import {createRoot} from 'react-dom/client';
import {routeQuery} from '@shell/targets.js';
import type {ShellContext} from '../context';
import {FinancesView} from './FinancesView';
import {PERIODS, type Period} from './types';

export async function mountFinances(root: HTMLElement, ctx: ShellContext): Promise<{destroy(): void}> {
  const requested = routeQuery().get('period') as Period | null;
  const initialPeriod = requested && PERIODS.includes(requested) ? requested : 'week';
  const host = document.createElement('div');
  host.className = 'finances-page';
  root.replaceChildren(host);
  const reactRoot = createRoot(host);
  await new Promise<void>(settled => reactRoot.render(<FinancesView ctx={ctx} initialPeriod={initialPeriod} onSettled={settled} />));
  return {destroy: () => reactRoot.unmount()};
}
