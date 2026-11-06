"use client";
import { useState } from "react";
import type { TodayView } from "../lib/feed";

type State =
  | { kind: "ready"; data: TodayView }
  | { kind: "loading" }
  | { kind: "error" };
export function Today({ initial }: { initial: TodayView | null }) {
  const [state, setState] = useState<State>(
    initial ? { kind: "ready", data: initial } : { kind: "error" },
  );
  async function refresh() {
    setState({ kind: "loading" });
    try {
      const response = await fetch("/api/feed", { cache: "no-store" });
      if (!response.ok) throw new Error("Feed unavailable");
      setState({ kind: "ready", data: (await response.json()) as TodayView });
    } catch {
      setState({ kind: "error" });
    }
  }
  return (
    <main>
      <h1>Today in LifeOS</h1>
      <p>A fictional day to explore my schedule and deadlines.</p>
      <nav aria-label="Jump to">
        <a
          href="#schedule"
          onClick={() => document.getElementById("schedule")?.focus()}
        >
          Schedule
        </a>{" "}
        ·{" "}
        <a
          href="#deadlines"
          onClick={() => document.getElementById("deadlines")?.focus()}
        >
          Deadlines
        </a>
      </nav>
      <button onClick={refresh} disabled={state.kind === "loading"}>
        Refresh day
      </button>
      {state.kind === "loading" && <p role="status">Loading the day…</p>}
      {state.kind === "error" && (
        <p role="alert">I couldn’t load the demo feed. Try refreshing.</p>
      )}
      {state.kind === "ready" && (
        <>
          <p>
            {state.data.day} · {state.data.timeZone}
          </p>
          <section id="schedule" tabIndex={-1}>
            <h2>Schedule</h2>
            {state.data.events.length ? (
              <ul>
                {state.data.events.map((event) => (
                  <li key={event.id}>
                    <strong>{event.title}</strong>{" "}
                    <time dateTime={event.start}>
                      {new Intl.DateTimeFormat("en-CA", {
                        timeZone: state.data.timeZone,
                        hour: "numeric",
                        minute: "2-digit",
                      }).format(new Date(event.start))}
                    </time>
                    {event.location && <> · {event.location}</>}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No events today.</p>
            )}
          </section>
          <section id="deadlines" tabIndex={-1}>
            <h2>Upcoming deadlines</h2>
            {state.data.deadlines.length ? (
              <ul>
                {state.data.deadlines.map((task) => (
                  <li key={task.id}>
                    <strong>{task.title}</strong> ·{" "}
                    <time dateTime={task.day!}>{task.day}</time>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No upcoming deadlines.</p>
            )}
            {state.data.unknown.length > 0 && (
              <p>{state.data.unknown.length} task(s) need a date checked.</p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
