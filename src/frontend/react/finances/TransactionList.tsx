import {useState} from 'react';
import {formatDate} from '@shell/ui.js';
import {FINANCE_CATEGORIES} from '@shell/finance-model.js';
import {signedAmount} from './format';
import type {TransactionRecord} from './types';

export type TransactionFilter = 'all' | 'uncategorized';

export interface TransactionListProps {
  transactions: TransactionRecord[];
  /** Count of transactions that still need a spending category. */
  unassigned: number;
  onSelect: (record: TransactionRecord) => void;
}

export function TransactionList({transactions, unassigned, onSelect}: TransactionListProps) {
  const [filter, setFilter] = useState<TransactionFilter>('all');
  const rows = transactions.filter(t => !t.data.archived && (filter === 'all' || t.data.category === filter));
  return (
    <section className="finance-history">
      <div className="panel-heading">
        <h2>Transactions</h2>
        <div className="finance-filter">
          <button type="button" className="text-button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            All
          </button>
          <button type="button" className="text-button" aria-pressed={filter === 'uncategorized'} onClick={() => setFilter('uncategorized')}>
            {'Needs a category' + (unassigned ? ', ' + unassigned : '')}
          </button>
        </div>
      </div>
      <div className="finance-transactions">
        {rows.map(record => (
          <article className="finance-transaction" key={record.id}>
            <button type="button" className="text-button finance-transaction-description" onClick={() => onSelect(record)}>
              <span>
                <strong>{record.data.description}</strong>
                <span>{formatDate(record.data.date) + ', ' + (FINANCE_CATEGORIES[record.data.category] || 'Choose category')}</span>
              </span>
            </button>
            <span className="finance-transaction-amount">{signedAmount(record.data.amountCents)}</span>
          </article>
        ))}
        {rows.length ? null : <p>No transactions in this view.</p>}
      </div>
    </section>
  );
}
