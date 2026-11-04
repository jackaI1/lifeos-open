import {render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {mountFinances} from './index';
import {BudgetPreviewDialog} from './dialogs';
import {fakeShell, record, snapshot} from '../test/finance-fixture';
import type {ConfiguredSnapshot} from './types';

vi.mock('@shell/assistant-chat.js', () => ({assistantButton: () => document.createElement('button')}));

describe('mountFinances (shell view contract)', () => {
  // mount() owns its own React root and resolves from an effect, exactly as in the browser,
  // so these tests run outside RTL's act() environment.
  const actEnvironment = globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean};
  beforeEach(() => void (actEnvironment.IS_REACT_ACT_ENVIRONMENT = false));
  afterEach(() => void (actEnvironment.IS_REACT_ACT_ENVIRONMENT = true));

  it('resolves only after the first load, honours ?period= and cleans up on destroy', async () => {
    history.replaceState(null, '', '/#finances?period=year');
    const {ctx, request} = fakeShell([record({description: 'Fictional bus pass', amountCents: 1000, category: 'other'})]);
    const main = document.querySelector('main')!;
    const view = await mountFinances(main, ctx);
    expect(request).toHaveBeenCalledWith('/api/finances?period=year');
    expect(main.firstElementChild).toHaveClass('finances-page');
    expect(within(main).getByText('This year')).toBeInTheDocument();
    expect(within(main).getByText('Fictional bus pass')).toBeInTheDocument();

    // Portalled popovers are attached to <body>; destroy must remove them with the view.
    await userEvent.click(within(main).getByRole('button', {name: 'Finance options'}));
    await waitFor(() => expect(within(document.body).getByRole('button', {name: 'Protected commitments'})).toBeVisible());
    expect(document.body.querySelector(':scope > .compact-popover')).not.toBeNull();
    view.destroy();
    expect(main.querySelector('.finances-page')).toBeEmptyDOMElement();
    expect(document.body.querySelector(':scope > .compact-popover')).toBeNull();
  });

  it('falls back to the week for an unknown period', async () => {
    history.replaceState(null, '', '/#finances?period=decade');
    const {ctx, request} = fakeShell([]);
    const view = await mountFinances(document.querySelector('main')!, ctx);
    expect(request).toHaveBeenCalledWith('/api/finances?period=week');
    view.destroy();
  });
});

describe('BudgetPreviewDialog', () => {
  it('recomputes the forecast as allowances change and rejects an impossible Dining split', async () => {
    const data = snapshot([]) as ConfiguredSnapshot;
    render(<BudgetPreviewDialog data={data} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/spending buffer through 2027-09-30/);
    const before = status.textContent;

    const shopping = screen.getByLabelText('Shopping each month');
    await userEvent.clear(shopping);
    await userEvent.type(shopping, '200');
    expect(status.textContent).not.toBe(before);

    const wants = screen.getByLabelText('Dining from Wants each week');
    await userEvent.clear(wants);
    await userEvent.type(wants, '999');
    expect(status).toHaveTextContent('The Wants portion must fit the total Dining allowance.');
  });
});
