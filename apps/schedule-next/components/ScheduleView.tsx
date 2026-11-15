'use client';

import {useState} from 'react';
import {parseScheduleResponse, type Schedule} from '../lib/graphql';

type Props = {initial: Schedule | null; initialError: string | null; fetchImpl?: typeof fetch};

function clock(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {hour: 'numeric', minute: '2-digit', timeZone}).format(new Date(value));
}

/** Shows the day's events and upcoming deadlines. Refresh asks the server route again. */
export function ScheduleView({initial, initialError, fetchImpl = fetch}: Props) {
  const [data, setData] = useState<Schedule | null>(initial);
  const [error, setError] = useState<string | null>(initialError);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    try {
      const response = await fetchImpl('/api/schedule', {cache: 'no-store'});
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(typeof (body as {error?: unknown}).error === 'string' ? (body as {error: string}).error : 'Refresh failed.');
      setData(parseScheduleResponse({data: body}));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Refresh failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>LifeOS schedule</h1>
      <button type="button" onClick={refresh} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh'}</button>
      {error ? <p role="alert">{error}</p> : null}
      {data ? (
        <>
          <section aria-labelledby="events-heading">
            <h2 id="events-heading">Events on {data.day.date}</h2>
            {data.day.events.length === 0 ? <p>Nothing scheduled.</p> : (
              <ul>
                {data.day.events.map(event => (
                  <li key={event.id}>
                    <time dateTime={event.start}>{clock(event.start, data.day.timeZone)}</time>–<time dateTime={event.end}>{clock(event.end, data.day.timeZone)}</time>{' '}
                    {event.title}{event.location ? `, ${event.location}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="deadlines-heading">
            <h2 id="deadlines-heading">Unfinished deadlines, next 14 days</h2>
            {data.deadlines.length === 0 ? <p>No open deadlines.</p> : (
              <ul>
                {data.deadlines.map(item => (
                  <li key={item.id}>
                    {item.title} due {item.due}{item.overdue ? ' (overdue)' : ''}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
