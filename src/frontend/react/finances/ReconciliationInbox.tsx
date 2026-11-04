import {formatDate, toast} from '@shell/ui.js';
import {reconciliationCandidates} from '@shell/finance-preview.js';
import {FINANCE_CATEGORIES} from '@shell/finance-model.js';
import {BusyButton, type DialogApi} from '../shared/shell-bridge';
import type {ShellContext} from '../context';
import {money} from './format';
import type {ConfiguredSnapshot, SpendingCategory, TransactionRecord} from './types';

const SPENDING: SpendingCategory[] = ['dining', 'shopping', 'big-purchase'];
type Decision = 'category' | 'transfer' | 'duplicate' | 'distinct';

export interface ReconciliationInboxProps {
  data: ConfiguredSnapshot;
  submit: ShellContext['outbox']['submit'];
  reload: () => Promise<void>;
  dialog: DialogApi;
}

/** Imported transactions that look like duplicates, transfers or still need a category. */
export function ReconciliationInbox({data, submit, reload, dialog}: ReconciliationInboxProps) {
  const candidates = reconciliationCandidates(data.transactions, data.reconciliation?.map(r => r.data));
  if (!candidates.length) return null;
  const byId = new Map(data.transactions.map(t => [t.id, t]));

  const decide = async (record: TransactionRecord, decision: Decision, extra: Record<string, unknown> = {}) => {
    const result = await submit('/api/finances/reconcile', {
      transactionId: record.id,
      transactionVersion: record.originalVersion ?? record.version,
      version: 0,
      decision,
      ...extra,
    });
    if (result.pending) {
      toast(result.reason);
      return;
    }
    await reload();
  };

  return (
    <details>
      <summary>{'Transactions to review, ' + candidates.length}</summary>
      {candidates.map(candidate => {
        const record = byId.get(candidate.id);
        if (!record) return null;
        const shown = record.original ?? record.data;
        const confirmDuplicate = () =>
          dialog.open(
            'Exclude duplicate?',
            <div>
              <p>Keep the other matching record in totals. This original import remains preserved.</p>
              <BusyButton
                className="quiet"
                onClick={async () => {
                  await decide(record, 'duplicate', {duplicateOf: candidate.otherIds[0]});
                  dialog.close();
                }}
              >
                Confirm duplicate
              </BusyButton>
            </div>,
          );
        return (
          <section className="practice-row" key={candidate.id}>
            <strong>{shown.description}</strong>
            <p>{formatDate(shown.date) + ', ' + money(shown.amountCents)}</p>
            <p>{candidate.reasons.join(', ')}</p>
            <div className="actions">
              {SPENDING.map(category => (
                <BusyButton key={category} className="quiet" onClick={() => decide(record, 'category', {category})}>
                  {FINANCE_CATEGORIES[category]}
                </BusyButton>
              ))}
              <BusyButton className="text-button" onClick={() => decide(record, 'transfer')}>
                Transfer / excluded
              </BusyButton>
              {candidate.otherIds.length ? (
                <button type="button" className="text-button" onClick={confirmDuplicate}>
                  Duplicate
                </button>
              ) : null}
              <BusyButton className="text-button" onClick={() => decide(record, 'distinct')}>
                Keep as recorded
              </BusyButton>
            </div>
          </section>
        );
      })}
    </details>
  );
}
