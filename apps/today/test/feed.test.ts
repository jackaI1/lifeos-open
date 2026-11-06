// @vitest-environment node
import { it, expect } from "vitest";
import { readToday } from "../lib/feed";
it("reads the real public feed using shared Toronto civil dates", async () => {
  const view = await readToday(Date.parse("2026-11-06T18:00:00Z"));
  expect(view.day).toBe("2026-11-06");
  expect(view.timeZone).toBe("America/Toronto");
  expect(view.events[0].title).toBe("Workshop");
  expect(view.deadlines.length).toBeGreaterThan(0);
  expect(view.unknown.length).toBeGreaterThan(0);
});
