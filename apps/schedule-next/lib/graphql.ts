import {z} from 'zod';

export const TODAY_QUERY = `query TodaySchedule($date: String) {
  day(date: $date) { date timeZone events { id title start end location } }
  deadlines(withinDays: 14) { id title due overdue status }
}`;

const EventSchema = z.object({id: z.string(), title: z.string(), start: z.string(), end: z.string(), location: z.string().nullable().optional()});
const DeadlineSchema = z.object({id: z.string(), title: z.string(), due: z.string(), overdue: z.boolean(), status: z.string().nullable().optional()});
export const ScheduleSchema = z.object({
  day: z.object({date: z.string(), timeZone: z.string(), events: z.array(EventSchema)}),
  deadlines: z.array(DeadlineSchema),
});
export type Schedule = z.infer<typeof ScheduleSchema>;

export class ScheduleError extends Error {}

/** Parse a GraphQL response body into the schedule shape, or throw a readable error. */
export function parseScheduleResponse(body: unknown): Schedule {
  const envelope = z.object({data: z.unknown().optional(), errors: z.array(z.object({message: z.string()})).optional()}).safeParse(body);
  if (!envelope.success) throw new ScheduleError('The schedule service sent an unexpected reply.');
  if (envelope.data.errors?.length) throw new ScheduleError(envelope.data.errors[0].message);
  const parsed = ScheduleSchema.safeParse(envelope.data.data);
  if (!parsed.success) throw new ScheduleError('The schedule service sent data in an unexpected shape.');
  return parsed.data;
}

/** Ask the schedule GraphQL API. Runs on the server only, because the token must not reach the browser. */
export async function fetchSchedule({url, token, date, fetchImpl = fetch}: {url: string; token: string; date?: string; fetchImpl?: typeof fetch}): Promise<Schedule> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {'content-type': 'application/json', authorization: `Bearer ${token}`},
      body: JSON.stringify({query: TODAY_QUERY, variables: {date: date ?? null}}),
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new ScheduleError('The schedule service is not reachable.');
  }
  if (!response.ok && response.status !== 400) throw new ScheduleError(`The schedule service answered ${response.status}.`);
  return parseScheduleResponse(await response.json());
}
