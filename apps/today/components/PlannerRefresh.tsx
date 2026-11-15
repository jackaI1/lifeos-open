"use client";
import {useState} from "react";
import {PLANNER_QUERY, type PlannerToday} from "../lib/planner-query";

export function timeLabel(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {timeZone, hour: "2-digit", minute: "2-digit", hour12: false}).format(new Date(value));
}

export function PlannerRefresh({initial, initialError}: {initial: PlannerToday | null; initialError: string | null}) {
  const [today, setToday] = useState(initial);
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/schedule-graphql", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({query: PLANNER_QUERY, variables: {deadlineDays: 14}}),
      });
      const body = (await response.json()) as {data?: {today: PlannerToday} | null; errors?: {message: string}[]};
      if (body.errors?.length || !body.data) throw new Error(body.errors?.[0]?.message ?? "The planner did not answer.");
      setToday(body.data.today);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Refresh failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <h1>Planner</h1>
      <p>Today's fictional schedule and open deadlines, read from the GraphQL endpoint.</p>
      <button type="button" onClick={refresh} disabled={loading}>
        {loading ? "Refreshing…" : "Refresh"}
      </button>
      {error ? <p role="alert">Could not refresh: {error}</p> : null}
      {today ? (
        <>
          <h2>Events on {today.day}</h2>
          {today.events.length ? (
            <ol>
              {today.events.map(event => (
                <li key={event.id}>
                  <time dateTime={event.start}>{timeLabel(event.start, today.timeZone)}</time> {event.title}
                  {event.location ? ` (${event.location})` : ""}
                </li>
              ))}
            </ol>
          ) : <p>No events today.</p>}
          <h2>Open deadlines</h2>
          {today.deadlines.length ? (
            <ul>
              {today.deadlines.map(deadline => (
                <li key={deadline.id}>
                  {deadline.title} due {deadline.day}{deadline.overdue ? " (overdue)" : ""}
                </li>
              ))}
            </ul>
          ) : <p>No upcoming deadlines.</p>}
          {today.withoutDate ? <p>{today.withoutDate} open task(s) have no date yet.</p> : null}
        </>
      ) : <p>No schedule loaded.</p>}
    </main>
  );
}
