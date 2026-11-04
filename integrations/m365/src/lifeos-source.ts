import {DatabaseSync} from 'node:sqlite';

/** A LifeOS coursework task, reduced to the fields this integration may share with Microsoft 365. */
export interface LifeosTask {
  id: string;
  title: string;
  status: string;
  courseCode: string;
  courseTitle: string;
  dueDate: string | null;
  dueAt: string | null;
  estimatedMinutes: number | null;
}

export interface LifeosSnapshot {
  tasks: LifeosTask[];
  timeZone: string;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const minutes = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/**
 * Reads tasks straight from the LifeOS SQLite file. The database is opened read-only, so the
 * sync can run while the app is open and can never modify workspace records. Task notes,
 * next steps and source links are deliberately not read.
 */
export function readLifeos(databasePath: string): LifeosSnapshot {
  const db = new DatabaseSync(databasePath, {readOnly: true});
  try {
    const parse = (data: string): Record<string, unknown> => {
      try {
        const value = JSON.parse(data) as unknown;
        return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
      } catch {
        return {};
      }
    };
    const courses = new Map<string, {code: string; title: string}>();
    for (const row of db.prepare("SELECT id,data FROM records WHERE kind='course'").all() as {id: string; data: string}[]) {
      const data = parse(row.data);
      courses.set(row.id, {code: text(data.code), title: text(data.title)});
    }
    const settings = db.prepare("SELECT data FROM records WHERE kind='settings' AND id='preferences'").get() as {data: string} | undefined;
    const timeZone = text(parse(settings?.data ?? '{}').timezone) || 'America/Toronto';
    const tasks: LifeosTask[] = [];
    for (const row of db.prepare("SELECT id,data FROM records WHERE kind='task' ORDER BY id").all() as {id: string; data: string}[]) {
      const data = parse(row.data);
      const course = courses.get(text(data.courseId));
      tasks.push({
        id: row.id,
        title: text(data.title),
        status: data.archived === true ? 'archived' : text(data.status) || 'todo',
        courseCode: course?.code ?? '',
        courseTitle: course?.title ?? '',
        dueDate: text(data.dueDate) || null,
        dueAt: text(data.dueAt) || null,
        estimatedMinutes: minutes(data.estimatedMinutes),
      });
    }
    return {tasks, timeZone};
  } finally {
    db.close();
  }
}
