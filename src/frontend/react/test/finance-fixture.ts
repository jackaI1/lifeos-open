import {vi} from 'vitest';
import {financeSummary} from '@shell/finance-model.js';
import type {ShellContext, SubmitResult} from '../context';
import type {FinanceConfig, FinanceSnapshot, Period, Transaction, TransactionRecord} from '../finances/types';

/** Fictional budget. Summaries come from the real shared model so fixtures stay consistent with the server. */
export const DAY = '2026-11-03';

export const config: FinanceConfig = {
  id: 'budget',
  version: 1,
  diningWeekly: 6000,
  diningWantsWeekly: 2000,
  shoppingMonthly: 8000,
  bigQuarterly: 18000,
  quarterAnchor: '2026-09-01',
  horizon: '2027-09-30',
  balanceAsOf: '2026-10-31',
  reconciledThrough: '2026-11-03',
  balances: {needs: 300000, wants: 250000, giving: 60000, other: 0},
  givingMonthly: [{name: 'Fictional food bank', amountCents: 2500}],
};

let next = 0;
export function record(data: Partial<Transaction> & Pick<Transaction, 'description' | 'amountCents'>, id = 'tx-' + ++next): TransactionRecord {
  return {id, version: 1, data: {date: DAY, category: 'uncategorized', ...data}};
}

export function snapshot(transactions: TransactionRecord[], period: Period = 'week', overrides: Partial<FinanceConfig> = {}): FinanceSnapshot {
  const merged = {...config, ...overrides};
  const summary = financeSummary({config: merged, transactions: transactions.map(t => t.data), day: DAY, period});
  return {configured: true, config: merged, summary, transactions, reconciliation: []};
}

/** A fake shell context whose API answers from a mutable list of transactions. */
export function fakeShell(initial: TransactionRecord[], options: {overrides?: Partial<FinanceConfig>} = {}) {
  const transactions = [...initial];
  const request = vi.fn(async (path: string) => {
    const url = new URL(path, 'http://lifeos.test');
    if (url.pathname === '/api/finances') return snapshot(transactions, (url.searchParams.get('period') ?? 'week') as Period, options.overrides);
    if (url.pathname === '/api/finances/rules') return {rules: []};
    throw new Error('Unexpected request ' + path);
  });
  const submit = vi.fn(async (path: string, body: Record<string, unknown>): Promise<SubmitResult> => {
    if (path === '/api/finances/transaction') {
      transactions.unshift(record(body as unknown as Transaction, String(body.id)));
      return {auditId: 'audit-1'};
    }
    return {auditId: 'audit-2'};
  });
  // Like the real shell (public/app.js, public/storage.js), these are methods that need their receiver.
  const outbox = {
    queue: 'outbox:',
    submit(this: {queue?: string} | undefined, path: string, body: Record<string, unknown>) {
      if (this?.queue !== 'outbox:') throw new TypeError('outbox.submit called without its receiver');
      return submit(path, body);
    },
  };
  const shell = {
    session: 'demo',
    request(this: {session?: string} | undefined, path: string) {
      if (this?.session !== 'demo') throw new TypeError('ctx.request called without its receiver');
      return request(path);
    },
    outbox,
    state: {routeHash: '#finances'},
    go: vi.fn(),
  };
  const ctx = shell as unknown as ShellContext;
  return {ctx, request, submit, transactions};
}
