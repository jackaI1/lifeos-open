import {afterEach, describe, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {ScheduleView} from '../components/ScheduleView';
import type {Schedule} from '../lib/graphql';

const schedule: Schedule = {
  day: {date: '2026-11-16', timeZone: 'America/Toronto', events: [{id: 'ev-lab', title: 'Fictional lab', start: '2026-11-16T19:00:00.000Z', end: '2026-11-16T21:00:00.000Z', location: 'Room A'}]},
  deadlines: [{id: 't-old', title: 'Old reading', due: '2026-11-13', overdue: true, status: 'todo'}],
};

afterEach(() => cleanup());

describe('ScheduleView', () => {
  it('shows the events and the deadlines, marking overdue ones in words', () => {
    render(<ScheduleView initial={schedule} initialError={null} />);
    expect(screen.getByRole('heading', {name: 'Events on 2026-11-16'})).toBeTruthy();
    expect(screen.getByText(/Fictional lab, Room A/)).toBeTruthy();
    expect(screen.getByText(/Old reading due 2026-11-13 \(overdue\)/)).toBeTruthy();
  });

  it('shows the server error when the first load failed', () => {
    render(<ScheduleView initial={null} initialError="The schedule service is not reachable." />);
    expect(screen.getByRole('alert').textContent).toBe('The schedule service is not reachable.');
    expect(screen.queryByRole('heading', {name: /Events on/})).toBeNull();
  });

  it('refreshes through the server route and shows the new data', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({...schedule, day: {...schedule.day, events: []}}), {status: 200}));
    render(<ScheduleView initial={schedule} initialError={null} fetchImpl={fetchImpl as unknown as typeof fetch} />);
    fireEvent.click(screen.getByRole('button', {name: 'Refresh'}));
    await waitFor(() => expect(screen.getByText('Nothing scheduled.')).toBeTruthy());
    expect(fetchImpl).toHaveBeenCalledWith('/api/schedule', {cache: 'no-store'});
  });

  it('keeps the old data and shows a clear message when refresh fails', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({error: 'The schedule service is not reachable.'}), {status: 503}));
    render(<ScheduleView initial={schedule} initialError={null} fetchImpl={fetchImpl as unknown as typeof fetch} />);
    fireEvent.click(screen.getByRole('button', {name: 'Refresh'}));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('The schedule service is not reachable.'));
    expect(screen.getByText(/Fictional lab, Room A/)).toBeTruthy();
  });
});
