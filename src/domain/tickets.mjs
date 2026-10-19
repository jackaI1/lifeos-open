import { DEFAULT_TIME_ZONE, instant, localDate, weekStart, weekday, minutesBetween, overlap } from './time.mjs';

export const WEEKLY_TICKETS = Object.freeze([
  { id: 'friend-call', category: 'friend-call', label: 'Friend call', minutes: 60 },
  { id: 'school-project', category: 'school-project', label: 'School-related personal project', minutes: 120 },
  { id: 'personal-project', category: 'personal-project', label: 'Personal-use project', minutes: 120 },
  { id: 'spanish', category: 'spanish', label: 'Spanish', minutes: 30 },
  { id: 'unwind', category: 'unwind', label: 'Intentional unwind', minutes: 30 },
  { id: 'wildcard-1', category: '*', label: 'Wildcard 1', minutes: 60 },
  { id: 'wildcard-2', category: '*', label: 'Wildcard 2', minutes: 60 }
].map(Object.freeze));

function activeSpends(ledger) {
  const undone = new Set(ledger.filter(item => item.type === 'undo').map(item => item.spendId));
  return ledger.filter(item => item.type === 'spend' && !undone.has(item.id));
}

export function ticketBalance({ date, ledger = [], tickets = WEEKLY_TICKETS, timeZone = DEFAULT_TIME_ZONE, availableMinutes = null }) {
  const week = weekStart(date), active = activeSpends(ledger).filter(item => weekStart(localDate(item.start, timeZone)) === week);
  const items = tickets.map(ticket => {
    const spentMinutes = active.filter(item => item.ticketId === ticket.id).reduce((sum, item) => sum + item.minutes, 0);
    return { ...ticket, spentMinutes, remainingMinutes: Math.max(0, ticket.minutes - spentMinutes) };
  });
  const remainingMinutes = items.reduce((sum, item) => sum + item.remainingMinutes, 0);
  return { weekStart: week, tickets: items, spentMinutes: items.reduce((sum, item) => sum + item.spentMinutes, 0), remainingMinutes, expires: true, debtMinutes: 0, availableMinutes, capacityGapMinutes: availableMinutes === null ? null : Math.max(0, remainingMinutes - availableMinutes), capacityMessage: availableMinutes !== null && remainingMinutes > availableMinutes ? 'There is less free time than remaining tickets. Let unused tickets expire and protect meals, sleep and Sunday rest.' : null };
}

export function spendTicket({ ledger = [], spend, tickets = WEEKLY_TICKETS, timeZone = DEFAULT_TIME_ZONE, allowFridayException = false }) {
  if (!spend?.id || !spend.ticketId || !spend.category || !spend.start || !spend.end) throw new Error('A ticket spend requires an ID, category and actual time interval');
  const existing = ledger.find(item => item.id === spend.id);
  if (existing) {
    if (['ticketId', 'category', 'start', 'end'].every(key => existing[key] === spend[key])) return { ledger, spend: existing, duplicate: true };
    throw new Error('The mutation ID already belongs to a different ticket spend');
  }
  const ticket = tickets.find(item => item.id === spend.ticketId);
  if (!ticket) throw new Error('Unknown ticket');
  if (ticket.category !== '*' && ticket.category !== spend.category) throw new Error('Named tickets stay tied to their category');
  const minutes = minutesBetween(spend.start, spend.end);
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('Actual ticket time must be positive');
  if (spend.minutes != null && Math.abs(spend.minutes - minutes) > 0.001) throw new Error('Ticket credit must match the actual allocated time');
  const date = localDate(spend.start, timeZone), endDate = localDate(instant(spend.end) - 1, timeZone), day = weekday(date);
  if (date !== endDate) throw new Error('Split a ticket session at midnight');
  if (day === 0) throw new Error('Sunday has no project or ticket scheduling');
  if (day === 5 && !allowFridayException) throw new Error('Friday is not a normal ticket evening; an explicit exception is required');
  if (activeSpends(ledger).some(item => overlap(item, spend))) throw new Error('The same actual time cannot receive two ticket credits');
  const balance = ticketBalance({ date, ledger, tickets, timeZone }).tickets.find(item => item.id === ticket.id);
  if (minutes > balance.remainingMinutes + 0.001) throw new Error('This spend exceeds the remaining weekly ticket');
  const record = { id: spend.id, type: 'spend', ticketId: spend.ticketId, category: spend.category, start: new Date(instant(spend.start)).toISOString(), end: new Date(instant(spend.end)).toISOString(), minutes, projectId: spend.projectId ?? null, note: spend.note ?? '', weekStart: weekStart(date), evidence: 'self-reported' };
  return { ledger: [...ledger, record], spend: record, duplicate: false };
}

export function undoTicket({ ledger = [], spendId, undoId, correctedAt }) {
  if (!undoId || !correctedAt) throw new Error('An undo ID and timestamp are required');
  const spend = ledger.find(item => item.id === spendId && item.type === 'spend');
  if (!spend) throw new Error('Ticket spend not found');
  const existing = ledger.find(item => item.id === undoId);
  if (existing) {
    if (existing.type === 'undo' && existing.spendId === spendId) return { ledger, duplicate: true, undo: existing };
    throw new Error('Undo mutation ID already used');
  }
  if (ledger.some(item => item.type === 'undo' && item.spendId === spendId)) throw new Error('This ticket spend has already been undone');
  const undo = { id: undoId, type: 'undo', spendId, correctedAt: new Date(instant(correctedAt)).toISOString() };
  return { ledger: [...ledger, undo], duplicate: false, undo };
}

export function suggestTicketSessions({ date, ledger = [], intervals = [], tickets = WEEKLY_TICKETS, timeZone = DEFAULT_TIME_ZONE }) {
  if (![1, 2, 3, 4, 6].includes(weekday(date))) return [];
  const balance = ticketBalance({ date, ledger, tickets, timeZone });
  return balance.tickets.filter(t => t.remainingMinutes > 0).map(ticket => {
    const continuous = intervals.find(i => minutesBetween(i.start, i.end) >= ticket.remainingMinutes);
    const partial = intervals.find(i => minutesBetween(i.start, i.end) > 0);
    return { ticketId: ticket.id, category: ticket.category, label: ticket.label, remainingMinutes: ticket.remainingMinutes, suggestedMinutes: continuous ? ticket.remainingMinutes : partial ? Math.min(ticket.remainingMinutes, minutesBetween(partial.start, partial.end)) : 0, slot: continuous ?? partial ?? null, contiguous: Boolean(continuous) };
  });
}
