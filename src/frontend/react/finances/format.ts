const cad = new Intl.NumberFormat('en-CA', {style: 'currency', currency: 'CAD'});

/** Integer cents → "$12.50" (same formatter as the legacy view). */
export const money = (cents: number): string => cad.format(cents / 100);

/** Signed ledger amount: expenses are positive cents and shown with a minus sign. */
export const signedAmount = (cents: number): string => (cents > 0 ? '−' : '+') + money(Math.abs(cents));

/** "2027-09-30" → "September 2027". */
export const monthYear = (day: string): string =>
  new Intl.DateTimeFormat(undefined, {month: 'long', year: 'numeric', timeZone: 'UTC'}).format(new Date(day + 'T12:00:00Z'));

export const PERIOD_LABELS = {week: 'This week', month: 'This month', year: 'This year'} as const;
