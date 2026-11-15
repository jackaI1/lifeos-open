import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {LIMITS, PLANNER_QUERY, demoFeedSource, localDatabaseSource, runScheduleQuery} from "../lib/schedule-graphql";

const NOW = Date.parse("2026-10-06T16:00:00Z");
const cleanup: (() => void)[] = [];
afterEach(() => { while (cleanup.length) cleanup.pop()!(); });

describe("schedule GraphQL over the demo feed", () => {
  it("returns today's events and open deadlines in date order", async () => {
    const result = await runScheduleQuery({query: PLANNER_QUERY, variables: {deadlineDays: 14}}, {source: demoFeedSource(), now: NOW});
    expect(result.errors).toBeUndefined();
    const today = (result.data as {today: {day: string; events: {title: string}[]; deadlines: {day: string}[]; withoutDate: number}}).today;
    expect(today.day).toBe("2026-10-06");
    expect(today.events.map(event => event.title)).toEqual(["Workshop", "Study group", "Office hours"]);
    const days = today.deadlines.map(deadline => deadline.day);
    expect(days).toEqual([...days].sort());
    expect(today.withoutDate).toBeGreaterThanOrEqual(1);
  });

  it("returns plain objects, so a server page can pass them to a client component", async () => {
    const result = await runScheduleQuery({query: PLANNER_QUERY}, {source: demoFeedSource(), now: NOW});
    const today = (result.data as {today: object}).today;
    expect(Object.getPrototypeOf(today)).toBe(Object.prototype);
  });

  it("uses the default deadline window when none is given", async () => {
    const result = await runScheduleQuery({query: "{ today { day deadlines { id } } }"}, {source: demoFeedSource(), now: NOW});
    expect(result.errors).toBeUndefined();
  });

  it("is read-only: mutations, fragments and unknown fields never run", async () => {
    const source = demoFeedSource();
    const mutation = await runScheduleQuery({query: "mutation { today { day } }"}, {source, now: NOW});
    expect(mutation.errors?.[0]?.message).toMatch(/Only read-only queries/);
    const fragment = await runScheduleQuery({query: "query { today { ...F } } fragment F on Today { day }"}, {source, now: NOW});
    expect(fragment.errors?.[0]?.message).toMatch(/Fragments are not supported/);
    const unknown = await runScheduleQuery({query: "{ today { secret } }"}, {source, now: NOW});
    expect(unknown.errors?.length).toBeGreaterThan(0);
  });

  it("limits query size and nesting depth before execution", async () => {
    const source = demoFeedSource();
    const big = await runScheduleQuery({query: `{ today { day } } # ${"x".repeat(LIMITS.maxQueryBytes)}`}, {source, now: NOW});
    expect(big.errors?.[0]?.message).toMatch(/limited to 2000 bytes/);
    const deep = await runScheduleQuery({query: "{ today { events { id } } }"}, {source, now: NOW, limits: {...LIMITS, maxDepth: 1}});
    expect(deep.errors?.[0]?.message).toMatch(/at most 1 levels/);
    const wide = await runScheduleQuery({query: "{ today { day timeZone withoutDate } }"}, {source, now: NOW, limits: {...LIMITS, maxFields: 2}});
    expect(wide.errors?.[0]?.message).toMatch(/at most 2 fields/);
  });

  it("validates the request shape and the deadline window", async () => {
    const source = demoFeedSource();
    expect((await runScheduleQuery(null, {source, now: NOW})).errors?.[0]?.message).toMatch(/query string/);
    expect((await runScheduleQuery({query: "{ today { day } }", variables: []}, {source, now: NOW})).errors?.[0]?.message).toMatch(/variables must be an object/);
    const zero = await runScheduleQuery({query: "query($d: Int){ today(deadlineDays: $d) { day } }", variables: {d: 0}}, {source, now: NOW});
    expect(zero.errors?.[0]?.message).toMatch(/between 1 and 60/);
    const text = await runScheduleQuery({query: "query($d: Int){ today(deadlineDays: $d) { day } }", variables: {d: "soon"}}, {source, now: NOW});
    expect(text.errors?.length).toBeGreaterThan(0);
  });
});

describe("schedule GraphQL over the local SQLite records", () => {
  it("reads the same records table the app writes, and skips rows it cannot read", async () => {
    const {LocalDatabase} = await import("../../../src/local/database");
    const dir = mkdtempSync(path.join(tmpdir(), "planner-graphql-"));
    cleanup.push(() => rmSync(dir, {recursive: true, force: true}));
    const file = path.join(dir, "workspace.sqlite");
    const db = new LocalDatabase(file);
    db.exec("CREATE TABLE records(kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(kind, id))");
    const insert = (kind: string, id: string, data: string) => db.prepare("INSERT INTO records VALUES(?,?,?,1,'t','t')").bind(kind, id, data).run();
    await insert("calendar-event", "lab", JSON.stringify({title: "Lab", start: "2026-10-06T14:00:00Z", end: "2026-10-06T15:00:00Z", location: "Fictional lab"}));
    await insert("calendar-event", "backwards", JSON.stringify({title: "Backwards", start: "2026-10-06T15:00:00Z", end: "2026-10-06T14:00:00Z"}));
    await insert("task", "report", JSON.stringify({title: "Lab report", dueDate: "2026-10-09", status: "todo"}));
    await insert("task", "broken", "{not json");
    await insert("task", "untitled", JSON.stringify({dueDate: "2026-10-09"}));
    db.close();
    const source = localDatabaseSource(file);
    const feed = await source.load(NOW);
    expect(feed.events.map(event => event.title)).toEqual(["Lab"]);
    expect(feed.tasks.map(task => task.title)).toEqual(["Lab report"]);
    const result = await runScheduleQuery({query: PLANNER_QUERY}, {source, now: NOW});
    const today = (result.data as {today: {events: {title: string}[]; deadlines: {title: string}[]}}).today;
    expect(today.events.map(event => event.title)).toEqual(["Lab"]);
    expect(today.deadlines.map(deadline => deadline.title)).toEqual(["Lab report"]);
  });
});
