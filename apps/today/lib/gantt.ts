import { z } from "zod";
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      Number.isFinite(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
    "Use a real date",
  );
export const taskSchema = z
  .array(
    z.object({
      id: z.string().min(1).max(80),
      title: z.string().min(1).max(160),
      duration: z.number().int().min(1).max(365),
      dependsOn: z.array(z.string()).max(100),
      deadline: day.optional(),
    }),
  )
  .max(100);
export type PlanTask = z.infer<typeof taskSchema>[number];
export type ScheduledTask = PlanTask & {
  start: number;
  finish: number;
  latestStart: number;
  slack: number;
  critical: boolean;
  overdue: boolean;
  missesDeadline: boolean;
};
const epoch = (date: string) => Date.parse(date + "T00:00:00Z") / 86400000;
export function schedule(
  input: PlanTask[],
  startDate: string,
  today = new Date().toISOString().slice(0, 10),
): ScheduledTask[] {
  const tasks = taskSchema.parse(input);
  day.parse(startDate);
  day.parse(today);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  if (byId.size !== tasks.length) throw Error("Task IDs must be unique.");
  const visiting = new Set<string>(),
    visited = new Set<string>(),
    order: PlanTask[] = [];
  function visit(id: string) {
    if (visiting.has(id)) throw Error("Circular dependency at " + id);
    if (visited.has(id)) return;
    const task = byId.get(id);
    if (!task) throw Error("Missing dependency: " + id);
    visiting.add(id);
    for (const parent of task.dependsOn) visit(parent);
    visiting.delete(id);
    visited.add(id);
    order.push(task);
  }
  for (const task of tasks) visit(task.id);
  const rows = new Map<string, ScheduledTask>();
  for (const task of order) {
    const start = Math.max(
      0,
      ...task.dependsOn.map((id) => rows.get(id)!.finish),
    );
    rows.set(task.id, {
      ...task,
      start,
      finish: start + task.duration,
      latestStart: 0,
      slack: 0,
      critical: false,
      overdue: !!task.deadline && task.deadline < today,
      missesDeadline:
        !!task.deadline &&
        epoch(startDate) + start + task.duration - 1 > epoch(task.deadline),
    });
  }
  const projectFinish = Math.max(
    0,
    ...Array.from(rows.values(), (r) => r.finish),
  );
  for (const task of [...order].reverse()) {
    const row = rows.get(task.id)!;
    const children = Array.from(rows.values()).filter((r) =>
      r.dependsOn.includes(task.id),
    );
    const finish = Math.min(
      projectFinish,
      ...children.map((r) => r.latestStart),
      ...(task.deadline ? [epoch(task.deadline) - epoch(startDate) + 1] : []),
    );
    row.latestStart = finish - task.duration;
    row.slack = row.latestStart - row.start;
    row.critical = row.slack <= 0;
  }
  return order.map((t) => rows.get(t.id)!);
}
export function planCSV(rows: ScheduledTask[], startDate: string) {
  const cell = (s: unknown) => '"' + String(s).replaceAll('"', '""') + '"';
  const date = (n: number) =>
    new Date((epoch(startDate) + n) * 86400000).toISOString().slice(0, 10);
  return [
    [
      "Task",
      "Start",
      "Last day",
      "Duration days",
      "Slack days",
      "Critical",
      "Overdue",
      "Misses deadline",
    ],
    ...rows.map((r) => [
      r.title,
      date(r.start),
      date(r.finish - 1),
      r.duration,
      r.slack,
      r.critical,
      r.overdue,
      r.missesDeadline,
    ]),
  ]
    .map((r) => r.map(cell).join(","))
    .join("\r\n");
}
export const samplePlan: PlanTask[] = [
  { id: "read", title: "Read the lab brief", duration: 1, dependsOn: [] },
  {
    id: "prepare",
    title: "Prepare the measurement plan",
    duration: 2,
    dependsOn: ["read"],
  },
  {
    id: "measure",
    title: "Collect sample measurements",
    duration: 1,
    dependsOn: ["prepare"],
  },
  {
    id: "draft",
    title: "Draft the report",
    duration: 2,
    dependsOn: ["measure"],
  },
  {
    id: "figures",
    title: "Prepare figures",
    duration: 1,
    dependsOn: ["measure"],
  },
  {
    id: "review",
    title: "Review and submit",
    duration: 1,
    dependsOn: ["draft", "figures"],
  },
];
