/**
 * Typed contract for the plain-JavaScript shell modules in public/.
 *
 * React views import them as `@shell/<file>.js`. The build marks these imports
 * external and rewrites them to `../<file>.js`, so the bundle shares the exact
 * module instances (dialog, toast, popovers) the rest of LifeOS uses. Vitest
 * aliases `@shell` to public/ so tests run against the real modules.
 * Only the functions React views actually use are declared here.
 */

declare module '@shell/ui.js' {
  export function formatDate(value: string | null | undefined, long?: boolean): string;
  export function toast(message: string): void;
  export function modal(title: string, content: Node, options?: {onclose?: () => void}): HTMLDialogElement;
  export function download(name: string, value: string | Blob, type?: string): void;
}

declare module '@shell/quiet-controls.js' {
  export interface Disclosure {
    node: HTMLElement;
    trigger: HTMLButtonElement;
    show(): void;
    hide(): void;
    toggle(): void;
    refresh(): void;
    destroy(): void;
  }
  export function controlIcon(name: string): SVGSVGElement;
  export function compactDisclosure(options: {
    label: string;
    icon?: string;
    content: string | Node | (() => string | Node);
    portal?: boolean;
    closeOnSelect?: boolean;
  }): Disclosure;
}

declare module '@shell/day-navigation.js' {
  /** Binds horizontal swipe gestures; `move(1)` is next, `move(-1)` previous. */
  export function swipeDays(node: HTMLElement, move: (delta: 1 | -1) => void): void;
}

declare module '@shell/assistant-chat.js' {
  export function assistantButton(ctx: import('./context').ShellContext, scope: string): HTMLButtonElement;
}

declare module '@shell/targets.js' {
  export function routeQuery(): URLSearchParams;
}

declare module '@shell/finance-model.js' {
  export const FINANCE_CATEGORIES: Record<import('./finances/types').FinanceCategory, string>;
  export function financeSummary(input: {
    config: import('./finances/types').FinanceConfig;
    transactions: import('./finances/types').Transaction[];
    day: string;
    period?: import('./finances/types').Period;
  }): import('./finances/types').FinanceSummary;
}

declare module '@shell/finance-preview.js' {
  type FinanceConfig = import('./finances/types').FinanceConfig;
  type FinanceSummary = import('./finances/types').FinanceSummary;
  type Transaction = import('./finances/types').Transaction;
  type TransactionRecord = import('./finances/types').TransactionRecord;
  type ReconciliationDecision = import('./finances/types').ReconciliationDecision;
  type BudgetChanges = import('./finances/types').BudgetChanges;
  export interface ReconciliationCandidate {
    id: string;
    reasons: string[];
    otherIds: string[];
  }
  export function reconciliationCandidates(transactions: TransactionRecord[], decisions?: ReconciliationDecision[]): ReconciliationCandidate[];
  export function previewBudget(input: {config: FinanceConfig; transactions: Transaction[]; day: string; changes: BudgetChanges}): FinanceSummary['forecast'] & {
    reconciled: boolean;
    asOf: string;
    protectedGiving: number;
  };
  export function protectedCommitments(config: FinanceConfig, summary: FinanceSummary): {
    giving: Array<{name?: string; title?: string; amountCents: number; monthlyCents: number}>;
    protectedGiving: number;
    remainingGivingCommitment: number;
    discretionary: number;
  };
}
