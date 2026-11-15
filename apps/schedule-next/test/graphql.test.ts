import {describe, expect, it, vi} from 'vitest';
import {fetchSchedule, parseScheduleResponse, ScheduleError, TODAY_QUERY} from '../lib/graphql';

const good = {
  data: {
    day: {date: '2026-11-16', timeZone: 'America/Toronto', events: [{id: 'ev-lab', title: 'Fictional lab', start: '2026-11-16T19:00:00.000Z', end: '2026-11-16T21:00:00.000Z', location: 'Room A'}]},
    deadlines: [{id: 't-essay', title: 'Essay draft', due: '2026-11-18', overdue: false, status: 'todo'}],
  },
};

describe('fetchSchedule', () => {
  it('sends the query with the bearer token and returns the parsed schedule', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(good), {status: 200}));
    const schedule = await fetchSchedule({url: 'http://schedule.test/graphql', token: 'fictional-token-0123456789abcdef', fetchImpl});
    expect(schedule.day.events[0].title).toBe('Fictional lab');
    expect(schedule.deadlines[0].due).toBe('2026-11-18');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://schedule.test/graphql');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer fictional-token-0123456789abcdef');
    expect(JSON.parse(String(init.body)).query).toBe(TODAY_QUERY);
  });

  it('turns an unreachable service and an error status into readable errors', async () => {
    await expect(fetchSchedule({url: 'http://x.test', token: 'fictional-token-0123456789abcdef', fetchImpl: async () => { throw new TypeError('fetch failed'); }}))
      .rejects.toThrow('not reachable');
    await expect(fetchSchedule({url: 'http://x.test', token: 'fictional-token-0123456789abcdef', fetchImpl: async () => new Response('', {status: 401})}))
      .rejects.toThrow('answered 401');
  });
});

describe('parseScheduleResponse', () => {
  it('surfaces GraphQL error messages', () => {
    expect(() => parseScheduleResponse({errors: [{message: 'withinDays must be a whole number from 1 to 60.'}]})).toThrow(ScheduleError);
    expect(() => parseScheduleResponse({errors: [{message: 'withinDays must be a whole number from 1 to 60.'}]})).toThrow('withinDays');
  });

  it('rejects data in an unexpected shape rather than rendering it', () => {
    expect(() => parseScheduleResponse({data: {day: {date: 1}}})).toThrow('unexpected shape');
    expect(() => parseScheduleResponse('not an object')).toThrow('unexpected reply');
  });
});
