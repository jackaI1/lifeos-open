import {useRef, useState} from 'react';
import {formatDate} from '@shell/ui.js';
import {FINANCE_CATEGORIES} from '@shell/finance-model.js';
import {previewBudget, protectedCommitments} from '@shell/finance-preview.js';
import {BusyButton} from '../shared/shell-bridge';
import {money} from './format';
import type {BudgetChanges, ConfiguredSnapshot, FinanceCategory, FinanceSummary, SpendingCategory, TransactionRecord} from './types';

export interface NewTransaction {
  id: string;
  date: string;
  description: string;
  amountCents: number;
  category: FinanceCategory;
}

const CATEGORY_OPTIONS = (Object.entries(FINANCE_CATEGORIES) as Array<[FinanceCategory, string]>).filter(([id]) => id !== 'uncategorized');

export function AddTransactionForm({day, onSave}: {day: string; onSave: (transaction: NewTransaction) => Promise<void>}) {
  // One id per open dialog makes retries after a network failure idempotent.
  const [id] = useState(() => crypto.randomUUID());
  const description = useRef<HTMLInputElement>(null);
  const date = useRef<HTMLInputElement>(null);
  const amount = useRef<HTMLInputElement>(null);
  const category = useRef<HTMLSelectElement>(null);
  return (
    <div className="form-stack">
      <label>
        Merchant or description
        <input ref={description} required maxLength={300} />
      </label>
      <div className="field-grid">
        <label>
          Date
          <input ref={date} type="date" defaultValue={day} />
        </label>
        <label>
          Expense amount
          <input ref={amount} type="number" min={0.01} step={0.01} required />
        </label>
      </div>
      <label>
        Category
        <select ref={category} aria-label="Category" defaultValue="uncategorized">
          <option value="uncategorized">Use saved category or choose later</option>
          {CATEGORY_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <BusyButton
        onClick={async () => {
          if (!description.current!.reportValidity() || !amount.current!.reportValidity() || !date.current!.reportValidity()) return;
          await onSave({
            id,
            date: date.current!.value,
            description: description.current!.value,
            amountCents: Math.round(Number(amount.current!.value) * 100),
            category: category.current!.value as FinanceCategory,
          });
        }}
      >
        Save transaction
      </BusyButton>
    </div>
  );
}

const SPENDING: SpendingCategory[] = ['dining', 'shopping', 'big-purchase'];

export function CategorizeDialog({record, onChoose}: {record: TransactionRecord; onChoose: (category: SpendingCategory) => Promise<void>}) {
  const d = record.data;
  const fixed = d.category === 'giving' || d.category === 'other' || d.category === 'excluded';
  return (
    <div>
      <p>{formatDate(d.date) + ', ' + money(d.amountCents)}</p>
      {fixed ? (
        <p>{'This item stays in ' + FINANCE_CATEGORIES[d.category] + '. It does not use the three spending allowances.'}</p>
      ) : (
        <div className="finance-category-choices">
          {SPENDING.map(category => (
            <BusyButton key={category} className="quiet" onClick={() => onChoose(category)}>
              {FINANCE_CATEGORIES[category]}
            </BusyButton>
          ))}
        </div>
      )}
    </div>
  );
}

export function ForecastDialog({forecast}: {forecast: FinanceSummary['forecast']}) {
  const f = forecast;
  const covered = f.spendingBuffer >= 0 && f.wantsBuffer >= 0 && f.needsBuffer >= 0;
  return (
    <div>
      <p>These estimates use your configured budget and recorded transactions.</p>
      <dl className="finance-forecast">
        <dt>Wants after reserved allowances</dt>
        <dd>{money(f.wantsBuffer)}</dd>
        <dt>Needs after estimated Dining split</dt>
        <dd>{money(f.needsBuffer)}</dd>
        <dt>Combined spending buffer</dt>
        <dd>{money(f.spendingBuffer)}</dd>
        <dt>Big Purchase allowance that fits this estimate</dt>
        <dd>{money(f.suggestedBigQuarterly) + ' / 3 months'}</dd>
        <dt>Extra Giving each month</dt>
        <dd>{money(f.givingExtraMonthly)}</dd>
      </dl>
      <p>{f.assumptions}</p>
      <p>
        {covered
          ? 'The recorded balances cover these allowances on paper. Unrecorded spending can change that result.'
          : 'The recorded balances do not cover these allowances. Review the budget before increasing spending.'}
      </p>
    </div>
  );
}

const ALLOWANCE_FIELDS: Array<[keyof BudgetChanges, string]> = [
  ['diningWeekly', 'Dining each week'],
  ['diningWantsWeekly', 'Dining from Wants each week'],
  ['shoppingMonthly', 'Shopping each month'],
  ['bigQuarterly', 'Big Purchase every three months'],
];

/** What-if editor: recomputes the forecast locally as allowances change. Nothing is saved. */
export function BudgetPreviewDialog({data}: {data: ConfiguredSnapshot}) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(ALLOWANCE_FIELDS.map(([key]) => [key, String(data.config[key] / 100)])) as Record<keyof BudgetChanges, string>,
  );
  const changes = Object.fromEntries(ALLOWANCE_FIELDS.map(([key]) => [key, Math.round(Number(values[key]) * 100)])) as unknown as BudgetChanges;
  const invalid = Object.values(changes).some(n => !Number.isFinite(n) || n < 0) || changes.diningWantsWeekly > changes.diningWeekly;
  const result = invalid
    ? null
    : previewBudget({config: data.config, transactions: data.transactions.map(r => r.data), day: data.summary.day, changes});
  return (
    <div className="form-stack">
      {ALLOWANCE_FIELDS.map(([key, label]) => (
        <label key={key}>
          {label}
          <input type="number" min={0} max={10000} step={0.01} value={values[key]} onChange={e => setValues(v => ({...v, [key]: e.target.value}))} />
        </label>
      ))}
      <div role="status">
        {result ? (
          <>
            <p>{money(result.spendingBuffer) + ' spending buffer through ' + result.horizon}</p>
            <p>{money(result.protectedGiving) + ' stays protected for Giving.'}</p>
            <p>{result.reconciled ? 'Balances reconciled through ' + result.asOf : 'Unverified until transactions are reconciled. Balance source: ' + result.asOf}</p>
            <details>
              <summary>Assumptions</summary>
              <p>{result.assumptions}</p>
            </details>
          </>
        ) : (
          'The Wants portion must fit the total Dining allowance.'
        )}
      </div>
    </div>
  );
}

export function CommitmentsDialog({data}: {data: ConfiguredSnapshot}) {
  const p = protectedCommitments(data.config, data.summary);
  return (
    <div>
      {p.giving.map((r, i) => (
        <p key={i}>{(r.name || r.title || 'Recurring giving') + ', ' + money(r.monthlyCents) + ' monthly'}</p>
      ))}
      <p>{money(p.remainingGivingCommitment) + ' reserved through ' + data.summary.forecast.horizon}</p>
      <p>{money(p.protectedGiving) + ' protected Give balance'}</p>
      <p>{money(p.discretionary) + ' recorded Needs and Wants'}</p>
      <p>{data.summary.needsReconciliation ? 'Balances need reconciliation.' : 'Balances match the saved reconciliation.'}</p>
    </div>
  );
}
