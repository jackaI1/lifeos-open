"use client";
import { useState } from "react";
import { schedule, planCSV, samplePlan, taskSchema } from "../lib/gantt";
export function Plan() {
  const [text, setText] = useState(JSON.stringify(samplePlan, null, 2));
  const [start, setStart] = useState(new Date().toISOString().slice(0, 10));
  let rows: ReturnType<typeof schedule> = [],
    error = "";
  try {
    rows = schedule(taskSchema.parse(JSON.parse(text)), start);
  } catch (e) {
    error = e instanceof Error ? e.message : "Check the plan";
  }
  const total = Math.max(1, ...rows.map((r) => r.finish));
  function download() {
    const url = URL.createObjectURL(
      new Blob([planCSV(rows, start)], { type: "text/csv" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "lifeos-plan.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <main>
      <h1>Plan a lab report</h1>
      <p>
        Try a fictional report, then edit its tasks. A red bar has no spare
        days. Deadlines include the named day. Durations use calendar days.
      </p>
      <label>
        First day{" "}
        <input
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
      </label>
      <details>
        <summary>Edit tasks and dependencies</summary>
        <label>
          Tasks as JSON
          <textarea
            rows={18}
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
          />
        </label>
      </details>
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        <>
          <div className="timeline">
            <svg
              role="img"
              aria-label="Task timeline, days from the first day"
              viewBox={`0 0 900 ${rows.length * 48 + 40}`}
            >
              {rows.map((r, i) => (
                <g key={r.id}>
                  <title>
                    {r.title}: starts day {r.start + 1}, {r.duration} days,
                    slack {r.slack} days{r.overdue ? ", overdue" : ""}
                    {r.missesDeadline ? ", misses deadline" : ""}
                  </title>
                  <text x="0" y={i * 48 + 30}>
                    {r.title}
                  </text>
                  <rect
                    x={300 + (r.start / total) * 580}
                    y={i * 48 + 10}
                    width={(r.duration / total) * 580}
                    height="28"
                    fill={r.critical ? "#b34428" : "#2665a8"}
                  />
                </g>
              ))}
            </svg>
          </div>
          <table>
            <caption>Schedule details</caption>
            <thead>
              <tr>
                <th>Task</th>
                <th>Starts on day</th>
                <th>Slack in days</th>
                <th>Warnings</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <th>{r.title}</th>
                  <td>{r.start + 1}</td>
                  <td>{r.slack}</td>
                  <td>
                    {[
                      r.critical ? "Critical" : "",
                      r.overdue ? "Overdue" : "",
                      r.missesDeadline ? "Misses deadline" : "",
                    ]
                      .filter(Boolean)
                      .join(", ") || "None"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={download}>Export CSV</button>
        </>
      )}
    </main>
  );
}
