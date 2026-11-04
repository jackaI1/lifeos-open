import {useEffect, useRef, useState, type ReactNode} from 'react';
import {download, formatDate, toast} from '@shell/ui.js';
import {assistantButton} from '@shell/assistant-chat.js';
import {BusyButton, IconButton, LegacyNode, ShellDisclosure, useShellDialog} from '../shared/shell-bridge';
import type {ShellContext} from '../context';
import {BudgetPeriod} from './BudgetPeriod';
import {TransactionList} from './TransactionList';
import {ReconciliationInbox} from './ReconciliationInbox';
import {AddTransactionForm, BudgetPreviewDialog, CategorizeDialog, CommitmentsDialog, ForecastDialog, type NewTransaction} from './dialogs';
import {useFinances} from './useFinances';
import {money, monthYear} from './format';
import {PERIODS, type ConfiguredSnapshot, type Period, type SpendingCategory, type TransactionRecord} from './types';

export interface FinancesViewProps {
  ctx: ShellContext;
  initialPeriod: Period;
  /** Called once the first load settles, so the shell can finish route setup. */
  onSettled?: () => void;
}

interface Undo {
  label: string;
  auditId: string;
}

export function FinancesView({ctx, initialPeriod, onSettled}: FinancesViewProps) {
  const [period, setPeriod] = useState(initialPeriod);
  const {data, error, loading, reload} = useFinances(ctx, period);
  const dialog = useShellDialog();

  // Undo links live until the next refresh, like the rest of the shell.
  const [undo, setUndo] = useState<Undo | null>(null);
  const nextUndo = useRef<Undo | null>(null);
  useEffect(() => {
    setUndo(nextUndo.current);
    nextUndo.current = null;
  }, [data]);

  const settled = useRef(false);
  useEffect(() => {
    if (!loading && !settled.current) {
      settled.current = true;
      onSettled?.();
    }
  }, [loading, onSettled]);

  const move = (delta: 1 | -1) => {
    const next = PERIODS[(PERIODS.indexOf(period) + delta + PERIODS.length) % PERIODS.length];
    history.replaceState(null, '', '#finances?period=' + next);
    ctx.state.routeHash = location.hash;
    setPeriod(next);
  };

  if (!data) {
    return (
      <>
        <PageHeading />
        {error ? (
          <>
            <p className="notice">{error.message}</p>
            <button type="button" className="quiet" onClick={() => void reload()}>
              Retry
            </button>
          </>
        ) : null}
      </>
    );
  }
  if (!data.configured) {
    return (
      <>
        <PageHeading />
        <p>Your financial source has not been imported yet.</p>
      </>
    );
  }

  const s = data.summary;
  // Keep the shell outbox as the receiver: its methods rely on `this`.
  const submit: ShellContext['outbox']['submit'] = (path, body) => ctx.outbox.submit(path, body);

  const saveTransaction = async (transaction: NewTransaction) => {
    const result = await submit('/api/finances/transaction', {...transaction});
    if (result.pending) return toast('Saved on this device');
    dialog.close();
    if (result.auditId) nextUndo.current = {label: 'Undo new transaction', auditId: result.auditId};
    await reload();
  };
  const categorize = (record: TransactionRecord) => async (category: SpendingCategory) => {
    const result = await submit('/api/finances/category', {id: record.id, version: record.version, category, remember: true});
    if (result.pending) return toast('Category saved on this device');
    dialog.close();
    if (result.auditId) nextUndo.current = {label: 'Undo category change', auditId: result.auditId};
    await reload();
    toast('Category saved');
  };
  const openForecast = () => dialog.open('Budget through ' + formatDate(s.forecast.horizon, true), <ForecastDialog forecast={s.forecast} />);
  const available = s.cards.reduce((sum, card) => sum + card.remaining, 0);
  const provisional = s.needsReconciliation;

  return (
    <>
      {/* Keyed so the shell re-decorates a fresh heading once actions exist. */}
      <PageHeading key="ready" reading={(provisional ? 'Up to ' : '') + money(available) + ' available'}>
        <IconButton icon="add" label="Add transaction" onClick={() => dialog.open('Add transaction', <AddTransactionForm day={s.day} onSave={saveTransaction} />)} />
        <ShellDisclosure portal label="Giving surplus" icon="gift">
          <strong>{money(s.forecast.givingExtraMonthly) + ' extra per month'}</strong>
          <p>{money(s.balances.giving) + ' protected Give balance'}</p>
          <p>{money(s.forecast.recurringMonthly) + ' recurring each month'}</p>
          <p>{'Provisional through ' + formatDate(s.forecast.horizon, true) + '. Recent spending needs reconciliation.'}</p>
        </ShellDisclosure>
        <LegacyNode create={() => assistantButton(ctx, 'finances')} />
        <ShellDisclosure portal label="Finance options" icon="more" className="form-stack">
          <FinanceOptions data={data} ctx={ctx} openDialog={dialog.open} openForecast={openForecast} />
        </ShellDisclosure>
      </PageHeading>
      <BudgetPeriod period={period} cards={s.cards} provisional={provisional} onMove={move} />
      {error ? (
        <p className="notice" role="alert">
          {error.message}{' '}
          <button type="button" className="text-button" onClick={() => void reload()}>
            Retry
          </button>
        </p>
      ) : null}
      <div className="finance-ledger">
        <aside className="finance-status">
          <div className="finance-freshness">
            <span>{'Latest recorded ' + formatDate(s.lastDate) + (provisional ? ', Recent bank activity not yet imported' : '')}</span>
            <ShellDisclosure label="Budget calculation details" icon="help">
              {s.forecast.assumptions}
            </ShellDisclosure>
            {undo ? (
              <BusyButton
                className="text-button"
                onClick={async () => {
                  await submit('/api/finances/undo', {auditId: undo.auditId});
                  await reload();
                }}
              >
                {undo.label}
              </BusyButton>
            ) : null}
          </div>
          <ReconciliationInbox data={data} submit={submit} reload={reload} dialog={dialog} />
          {s.forecast.spendingBuffer < 0 ? (
            <button type="button" className="quiet finance-budget-warning" onClick={openForecast}>
              {'Budget needs review, ' + money(-s.forecast.spendingBuffer) + ' shortfall'}
            </button>
          ) : null}
        </aside>
        <TransactionList
          transactions={data.transactions}
          unassigned={s.unassigned}
          onSelect={record => dialog.open(record.data.description, <CategorizeDialog record={record} onChoose={categorize(record)} />)}
        />
      </div>
      {dialog.element}
    </>
  );
}

/** Same markup as ui.js `heading()`; the shell appends search and timer tools to `.actions`. */
function PageHeading({reading, children}: {reading?: string; children?: ReactNode}) {
  return (
    <div className="page-heading">
      <div className="page-display">
        <h1>Finances</h1>
        <div className="display-reading" hidden={reading == null}>
          {reading}
        </div>
      </div>
      <div className="actions">{children}</div>
    </div>
  );
}

function FinanceOptions({data, ctx, openDialog, openForecast}: {
  data: ConfiguredSnapshot;
  ctx: ShellContext;
  openDialog: (title: string, content: ReactNode) => void;
  openForecast: () => void;
}) {
  return (
    <>
      <button type="button" className="text-button" onClick={() => openDialog('Preview allowance changes', <BudgetPreviewDialog data={data} />)}>
        Preview allowance changes
      </button>
      <button type="button" className="text-button" onClick={() => openDialog('Protected commitments', <CommitmentsDialog data={data} />)}>
        Protected commitments
      </button>
      <button type="button" className="text-button" onClick={openForecast}>
        {'Budget through ' + monthYear(data.summary.forecast.horizon)}
      </button>
      <button
        type="button"
        className="text-button"
        onClick={() => download('lifeos-finances.json', JSON.stringify({config: data.config, transactions: data.transactions}, null, 2), 'application/json')}
      >
        Download category history
      </button>
      <BusyButton
        className="text-button"
        onClick={async () => {
          const rules = await ctx.request('/api/finances/rules');
          download('finance-category-rules.json', JSON.stringify(rules, null, 2), 'application/json');
        }}
      >
        Download learned categories
      </BusyButton>
    </>
  );
}
