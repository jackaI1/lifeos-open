import {render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach, expect, it, vi} from "vitest";
import {PlannerRefresh} from "../components/PlannerRefresh";
import type {PlannerToday} from "../lib/planner-query";

afterEach(() => vi.unstubAllGlobals());

const today: PlannerToday = {
  day: "2026-10-06",
  timeZone: "America/Toronto",
  events: [{id: "workshop", title: "Workshop", start: "2026-10-06T18:05:00Z", end: "2026-10-06T19:30:00Z", location: "Fictional design studio"}],
  deadlines: [{id: "outline", title: "Map the feedback loop", day: "2026-10-08", status: "todo", overdue: false}],
  withoutDate: 1,
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {"content-type": "application/json"}});

it("shows the server-rendered events in the local time zone, deadlines and undated count", () => {
  render(<PlannerRefresh initial={today} initialError={null} />);
  expect(screen.getByText(/14:05/)).toBeInTheDocument();
  expect(screen.getByText(/Workshop/)).toBeInTheDocument();
  expect(screen.getByText(/Map the feedback loop due 2026-10-08/)).toBeInTheDocument();
  expect(screen.getByText("1 open task(s) have no date yet.")).toBeInTheDocument();
});

it("refresh posts the planner query and shows the answer", async () => {
  const fetchMock = vi.fn(async () => json({data: {today: {...today, events: []}}}));
  vi.stubGlobal("fetch", fetchMock);
  render(<PlannerRefresh initial={today} initialError={null} />);
  await userEvent.click(screen.getByRole("button", {name: "Refresh"}));
  await waitFor(() => expect(screen.getByText("No events today.")).toBeInTheDocument());
  expect(fetchMock).toHaveBeenCalledWith("/api/schedule-graphql", expect.objectContaining({method: "POST"}));
  const sent = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
  expect(sent.query).toContain("today(deadlineDays: $deadlineDays)");
  expect(sent.variables).toEqual({deadlineDays: 14});
});

it("shows GraphQL errors as a readable alert", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => json({errors: [{message: "Queries are limited to 2000 bytes."}]}, 400)));
  render(<PlannerRefresh initial={null} initialError={null} />);
  await userEvent.click(screen.getByRole("button", {name: "Refresh"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("Queries are limited to 2000 bytes.");
});

it("shows a network failure instead of a blank page", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
  render(<PlannerRefresh initial={today} initialError={null} />);
  await userEvent.click(screen.getByRole("button", {name: "Refresh"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("Failed to fetch");
  expect(screen.getByRole("button", {name: "Refresh"})).toBeEnabled();
});
