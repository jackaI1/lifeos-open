// @vitest-environment node
import { it, expect, vi } from "vitest";
const read = vi.hoisted(() => vi.fn());
vi.mock("../lib/feed", () => ({ readToday: read }));
import { GET } from "../app/api/feed/route";
it("serves a fresh typed view and returns a safe 503 error on disk failure", async () => {
  const data = {
    day: "2026-11-06",
    events: [],
    deadlines: [],
    unknown: [],
    timeZone: "America/Toronto",
  };
  read.mockResolvedValueOnce(data);
  const good = await GET();
  expect(good.status).toBe(200);
  expect(good.headers.get("cache-control")).toBe("no-store");
  expect(await good.json()).toEqual(data);
  read.mockRejectedValueOnce(Error("/private/path/not-for-the-client"));
  const bad = await GET();
  expect(bad.status).toBe(503);
  expect(await bad.json()).toEqual({ error: "The demo feed is unavailable." });
});
