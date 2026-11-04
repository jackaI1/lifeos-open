import {render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';
import {FinancesView} from './FinancesView';
import {fakeShell, record, snapshot} from '../test/finance-fixture';
import type {FinanceSnapshot} from './types';

vi.mock('@shell/assistant-chat.js', () => ({
  assistantButton: () => {
    const button = document.createElement('button');
    button.setAttribute('aria-label', 'Financial advisor');
    return button;
  },
}));

const lunch = () => record({description: 'Fictional campus lunch', amountCents: 1250, category: 'dining'}, 'lunch');
const bookstore = () => record({description: 'Fictional bookstore', amountCents: 3000}, 'books');

function renderView(shell = fakeShell([lunch(), bookstore()])) {
  const main = document.querySelector('main')!;
  const view = render(<FinancesView ctx={shell.ctx} initialPeriod="week" />, {container: main});
  return {...shell, ...view, user: userEvent.setup()};
}

const dialog = () => within(document.querySelector<HTMLElement>('#dialog')!);

describe('FinancesView', () => {
  it('loads the selected period and shows allowances, the available reading and transactions', async () => {
    const {request} = renderView();
    expect(await screen.findByText('Fictional campus lunch')).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith('/api/finances?period=week');
    expect(screen.getByRole('heading', {level: 1, name: 'Finances'})).toBeInTheDocument();
    // ($60 − $12.50) dining + $80 shopping + $180 big purchase; the uncategorized $30 uses no allowance yet.
    expect(screen.getByText('$307.50 available')).toBeInTheDocument();
    const dining = screen.getByRole('heading', {name: 'Dining'}).closest('.finance-allowance') as HTMLElement;
    expect(within(dining).getByText('$47.50')).toBeInTheDocument();
    expect(within(dining).getByText('$12.50 recorded')).toBeInTheDocument();
    expect(screen.getByText('−$12.50')).toBeInTheDocument();
    expect(screen.getByText(/Nov 3, Dining/)).toBeInTheDocument();
  });

  it('moves between week, month and year and keeps the URL in sync', async () => {
    const {request, user, ctx} = renderView();
    await screen.findByText('This week');
    await user.click(screen.getByRole('button', {name: 'Next budget period'}));
    expect(await screen.findByText('This month')).toBeInTheDocument();
    expect(request).toHaveBeenLastCalledWith('/api/finances?period=month');
    expect(location.hash).toBe('#finances?period=month');
    expect(ctx.state.routeHash).toBe('#finances?period=month');
    await user.click(screen.getByRole('button', {name: 'Previous budget period'}));
    await user.click(screen.getByRole('button', {name: 'Previous budget period'}));
    expect(await screen.findByText('This year')).toBeInTheDocument();
  });

  it('filters transactions that still need a category', async () => {
    const {user} = renderView();
    const needs = await screen.findByRole('button', {name: 'Needs a category, 1'});
    expect(screen.getByRole('button', {name: 'All'})).toHaveAttribute('aria-pressed', 'true');
    await user.click(needs);
    expect(needs).toHaveAttribute('aria-pressed', 'true');
    const list = within(document.querySelector<HTMLElement>('.finance-transactions')!);
    expect(list.queryByText('Fictional campus lunch')).not.toBeInTheDocument();
    expect(list.getByText('Fictional bookstore')).toBeInTheDocument();
  });

  it('adds a transaction through the outbox, refreshes totals and offers undo', async () => {
    const {user, submit} = renderView();
    await screen.findByText('Fictional campus lunch');
    await user.click(screen.getByRole('button', {name: 'Add transaction'}));
    await user.type(dialog().getByLabelText('Merchant or description'), 'Fictional grocery basket');
    await user.type(dialog().getByLabelText('Expense amount'), '8.25');
    await user.selectOptions(dialog().getByLabelText('Category', {selector: 'select'}), 'dining');
    await user.click(dialog().getByRole('button', {name: 'Save transaction'}));

    expect(await screen.findByText('Fictional grocery basket')).toBeInTheDocument();
    expect(submit).toHaveBeenCalledWith('/api/finances/transaction', expect.objectContaining({description: 'Fictional grocery basket', amountCents: 825, category: 'dining', date: '2026-11-03'}));
    expect(document.querySelector('#dialog')).not.toHaveAttribute('open');
    expect(screen.getByText('$299.25 available')).toBeInTheDocument();

    await user.click(screen.getByRole('button', {name: 'Undo new transaction'}));
    expect(submit).toHaveBeenCalledWith('/api/finances/undo', {auditId: 'audit-1'});
    await waitFor(() => expect(screen.queryByRole('button', {name: 'Undo new transaction'})).not.toBeInTheDocument());
  });

  it('does not save an incomplete transaction', async () => {
    const {user, submit} = renderView();
    await screen.findByText('Fictional campus lunch');
    await user.click(screen.getByRole('button', {name: 'Add transaction'}));
    await user.click(dialog().getByRole('button', {name: 'Save transaction'}));
    expect(submit).not.toHaveBeenCalled();
    expect(document.querySelector('#dialog')).toHaveAttribute('open');
  });

  it('keeps the dialog open and reports when a change is only saved on this device', async () => {
    const shell = fakeShell([lunch()]);
    shell.submit.mockResolvedValueOnce({pending: true, reason: 'Offline'});
    const {user} = renderView(shell);
    await screen.findByText('Fictional campus lunch');
    await user.click(screen.getByRole('button', {name: 'Add transaction'}));
    await user.type(dialog().getByLabelText('Merchant or description'), 'Fictional snack');
    await user.type(dialog().getByLabelText('Expense amount'), '2');
    await user.click(dialog().getByRole('button', {name: 'Save transaction'}));
    await waitFor(() => expect(document.querySelector('#toast')).toHaveTextContent('Saved on this device'));
    expect(document.querySelector('#dialog')).toHaveAttribute('open');
  });

  it('recategorizes a transaction and remembers the choice', async () => {
    const {user, submit} = renderView();
    await user.click(await screen.findByRole('button', {name: /Fictional bookstore/}));
    expect(dialog().getByRole('heading', {name: 'Fictional bookstore'})).toBeInTheDocument();
    await user.click(dialog().getByRole('button', {name: 'Shopping'}));
    expect(submit).toHaveBeenCalledWith('/api/finances/category', {id: 'books', version: 1, category: 'shopping', remember: true});
    await waitFor(() => expect(document.querySelector('#toast')).toHaveTextContent('Category saved'));
    expect(screen.getByRole('button', {name: 'Undo category change'})).toBeInTheDocument();
  });

  it('explains that Giving items do not use spending allowances', async () => {
    const shell = fakeShell([record({description: 'Fictional donation', amountCents: 2500, category: 'giving'}, 'gift')]);
    const {user} = renderView(shell);
    await user.click(await screen.findByRole('button', {name: /Fictional donation/}));
    expect(dialog().getByText('This item stays in Giving. It does not use the three spending allowances.')).toBeInTheDocument();
    expect(dialog().queryByRole('button', {name: 'Dining'})).not.toBeInTheDocument();
  });

  it('lists possible duplicates for review and records the decision', async () => {
    const twin = (id: string) => record({description: 'Fictional cafe', amountCents: 450, category: 'dining'}, id);
    const {user, submit} = renderView(fakeShell([twin('a'), twin('b')]));
    const summary = await screen.findByText('Transactions to review, 2');
    await user.click(summary);
    const first = summary.parentElement!.querySelector('section') as HTMLElement;
    expect(within(first).getByText('Possible duplicate')).toBeInTheDocument();
    await user.click(within(first).getByRole('button', {name: 'Keep as recorded'}));
    expect(submit).toHaveBeenCalledWith('/api/finances/reconcile', {transactionId: 'a', transactionVersion: 1, version: 0, decision: 'distinct'});

    await user.click(within(first).getByRole('button', {name: 'Duplicate'}));
    await user.click(dialog().getByRole('button', {name: 'Confirm duplicate'}));
    expect(submit).toHaveBeenCalledWith('/api/finances/reconcile', expect.objectContaining({decision: 'duplicate', duplicateOf: 'b'}));
  });

  it('warns about a shortfall and opens the forecast', async () => {
    const shell = fakeShell([lunch()], {overrides: {balances: {needs: 0, wants: 0, giving: 0, other: 0}}});
    const {user} = renderView(shell);
    const warning = await screen.findByRole('button', {name: /Budget needs review, .* shortfall/});
    await user.click(warning);
    expect(dialog().getByRole('heading', {name: /Budget through Thursday, September 30, 2027/})).toBeInTheDocument();
    expect(dialog().getByText(/do not cover these allowances/)).toBeInTheDocument();
  });

  it('shows a retryable error when the first load fails', async () => {
    const shell = fakeShell([lunch()]);
    shell.request.mockRejectedValueOnce(new Error('Finances are temporarily unavailable'));
    const {user} = renderView(shell);
    expect(await screen.findByText('Finances are temporarily unavailable')).toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: 'Retry'}));
    expect(await screen.findByText('Fictional campus lunch')).toBeInTheDocument();
  });

  it('explains when no financial source has been imported', async () => {
    const shell = fakeShell([]);
    shell.request.mockResolvedValueOnce({configured: false});
    renderView(shell);
    expect(await screen.findByText('Your financial source has not been imported yet.')).toBeInTheDocument();
  });

  it('ignores a slow response for a period the user already left', async () => {
    const shell = fakeShell([lunch()]);
    const {user} = renderView(shell);
    await screen.findByText('This week');
    let releaseMonth!: (value: FinanceSnapshot) => void;
    shell.request.mockImplementationOnce(() => new Promise(resolve => (releaseMonth = resolve)));
    await user.click(screen.getByRole('button', {name: 'Next budget period'}));
    await user.click(screen.getByRole('button', {name: 'Next budget period'}));
    expect(await screen.findByText('This year')).toBeInTheDocument();
    await waitFor(() => expect(shell.request).toHaveBeenLastCalledWith('/api/finances?period=year'));
    releaseMonth(snapshot([record({description: 'Stale month row', amountCents: 1}, 'stale')], 'month'));
    await new Promise(r => setTimeout(r, 0));
    expect(screen.queryByText('Stale month row')).not.toBeInTheDocument();
    expect(screen.getByText('Fictional campus lunch')).toBeInTheDocument();
  });

  it('keeps shell-owned tools that app.js appends to the heading across re-renders', async () => {
    const {user} = renderView();
    await screen.findByText('Fictional campus lunch');
    const actions = document.querySelector('.page-heading > .actions')!;
    const finder = document.createElement('button');
    finder.className = 'action-finder';
    actions.append(finder);
    await user.click(screen.getByRole('button', {name: 'Next budget period'}));
    await screen.findByText('This month');
    expect(actions.isConnected).toBe(true);
    expect(actions.lastElementChild).toBe(finder);
    expect([...actions.querySelectorAll('button')].map(b => b.getAttribute('aria-label'))).toEqual(['Add transaction', 'Giving surplus', 'Financial advisor', 'Finance options', null]);
  });
});
