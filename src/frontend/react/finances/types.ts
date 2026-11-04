/** Shapes returned by GET /api/finances (src/cloud/finances.mjs). Amounts are integer cents. */
export type FinanceCategory = 'dining' | 'shopping' | 'big-purchase' | 'giving' | 'other' | 'excluded' | 'uncategorized';
export type SpendingCategory = 'dining' | 'shopping' | 'big-purchase';
export type Period = 'week' | 'month' | 'year';
export const PERIODS: readonly Period[] = ['week', 'month', 'year'];

export interface Transaction {
  date: string;
  description: string;
  amountCents: number;
  category: FinanceCategory;
  account?: string;
  archived?: boolean;
  recurring?: boolean;
}

export interface TransactionRecord {
  id: string;
  version: number;
  data: Transaction;
  /** Present when a reconciliation decision overrides the imported record. */
  original?: Transaction;
  originalVersion?: number;
}

export interface ReconciliationDecision {
  transactionId: string;
  decision: 'category' | 'transfer' | 'duplicate' | 'distinct';
}

export interface BudgetChanges {
  diningWeekly: number;
  diningWantsWeekly: number;
  shoppingMonthly: number;
  bigQuarterly: number;
}

export interface FinanceConfig extends BudgetChanges {
  id: string;
  version: number;
  quarterAnchor: string;
  horizon: string;
  balanceAsOf: string;
  reconciledThrough?: string;
  balances: Record<string, number>;
  givingMonthly: Array<{name?: string; title?: string; amountCents: number}>;
}

export interface AllowanceCard {
  id: SpendingCategory;
  allowance: number;
  spent: number;
  remaining: number;
  rule: string;
}

export interface FinanceSummary {
  day: string;
  period: Period;
  cards: AllowanceCard[];
  balances: {needs: number; wants: number; giving: number; other: number};
  forecast: {
    horizon: string;
    months: number;
    wantsBuffer: number;
    needsBuffer: number;
    spendingBuffer: number;
    suggestedBigQuarterly: number;
    givingExtraMonthly: number;
    recurringMonthly: number;
    assumptions: string;
  };
  unassigned: number;
  lastDate: string;
  needsReconciliation: boolean;
}

export type FinanceSnapshot =
  | {configured: false}
  | {
      configured: true;
      config: FinanceConfig;
      summary: FinanceSummary;
      transactions: TransactionRecord[];
      reconciliation?: Array<{id: string; data: ReconciliationDecision}>;
    };

export type ConfiguredSnapshot = Extract<FinanceSnapshot, {configured: true}>;
