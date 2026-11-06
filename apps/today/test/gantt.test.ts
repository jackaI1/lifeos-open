import { it, expect } from "vitest";
import { schedule, planCSV, type PlanTask } from "../lib/gantt";
const t = (
  id: string,
  duration: number,
  dependsOn: string[] = [],
  deadline?: string,
): PlanTask => ({ id, title: id, duration, dependsOn, deadline });
it("forward and backward passes find the longest branch and slack", () => {
  const r = schedule(
    [t("a", 2), t("b", 3, ["a"]), t("c", 1, ["a"]), t("d", 1, ["b", "c"])],
    "2026-11-01",
    "2026-11-01",
  );
  expect(r.map((x) => [x.start, x.finish, x.slack, x.critical])).toEqual([
    [0, 2, 0, true],
    [2, 5, 0, true],
    [2, 3, 2, false],
    [5, 6, 0, true],
  ]);
});
it("applies deadlines backwards and flags negative slack and overdue", () => {
  const r = schedule(
    [t("a", 2), t("b", 2, ["a"], "2026-11-03")],
    "2026-11-01",
    "2026-11-04",
  );
  expect(r[0].slack).toBe(-1);
  expect(r[1]).toMatchObject({ overdue: true, missesDeadline: true });
});
it("includes the last deadline day", () => {
  expect(
    schedule([t("a", 1, [], "2026-11-01")], "2026-11-01", "2026-11-01")[0],
  ).toMatchObject({ slack: 0, overdue: false, missesDeadline: false });
});
it("handles disconnected tasks and empty plans", () => {
  expect(schedule([], "2026-11-01")).toEqual([]);
  expect(schedule([t("a", 4), t("b", 2)], "2026-11-01")[1].slack).toBe(2);
});
it.each([
  [[t("a", 1, ["b"]), t("b", 1, ["a"])], "Circular"],
  [[t("a", 1, ["a"])], "Circular"],
  [[t("a", 1, ["missing"])], "Missing"],
  [[t("a", 1), t("a", 2)], "unique"],
  [[t("a", 0)], "Too small"],
])("rejects an invalid dependency graph", (tasks, message) => {
  expect(() => schedule(tasks as PlanTask[], "2026-11-01")).toThrow(
    message as string,
  );
});
it("rejects impossible dates", () => {
  expect(() => schedule([], "2026-02-30")).toThrow();
});
it("exports escaped cells and inclusive finish dates", () => {
  const r = schedule(
    [{ ...t("a", 2), title: 'Read, "then" write' }],
    "2026-11-01",
  );
  expect(planCSV(r, "2026-11-01")).toContain(
    '"Read, ""then"" write","2026-11-01","2026-11-02"',
  );
});
