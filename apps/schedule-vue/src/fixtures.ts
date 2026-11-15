// Fictional feed used by the tests. It mirrors the shape of the public demo feed.
export const feed = {
  schemaVersion: 1,
  fictional: true,
  anchorDate: '2026-10-06',
  timeZone: 'America/Toronto',
  events: [
    {id: 'workshop', title: 'Workshop', start: '2026-10-06T14:05:00Z', end: '2026-10-06T15:30:00Z', location: 'Fictional design studio'},
    {id: 'study', title: 'Study group', start: '2026-10-06T14:10:00Z', end: '2026-10-06T15:00:00Z'},
    {id: 'hours', title: 'Office hours', start: '2026-10-08T18:30:00Z', end: '2026-10-08T19:00:00Z'},
  ],
  tasks: [
    {id: 'outline', title: 'Map the feedback loop', dueAt: '2026-10-08T20:00:00Z', status: 'todo'},
    {id: 'reading', title: 'Read the watershed example', dueDate: '2026-10-09', status: 'todo'},
    {id: 'undated', title: 'Check the reflection deadline', status: 'todo'},
    {id: 'finished', title: 'Done already', dueDate: '2026-10-07', status: 'complete'},
    {id: 'old', title: 'Overdue reading', dueDate: '2026-10-04', status: 'todo'},
  ],
};
