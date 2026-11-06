import {writeFile} from 'node:fs/promises';
import {scenarioRecords, scenarioEvents, STORY_DAY} from '../demo/scenarios.mjs';
import {parseFeed} from '../src/shared/today.ts';

// Explicit allowlist from authored examples only. Never read a workspace database.
const feed = parseFeed({schemaVersion: 1, fictional: true, anchorDate: STORY_DAY, timeZone: 'America/Toronto',
  events: scenarioEvents('overlap').map(({id, title, start, end, location}) => ({id, title, start, end, location})),
  tasks: [...scenarioRecords().task.map(({id, data}) => ({id, title: data.title, dueAt: data.dueAt, dueDate: data.dueDate, status: data.status})),
    {id: 'demo-prelab', title: 'Systems pre-lab checklist', dueDate: STORY_DAY, status: 'todo'}]});
await writeFile(new URL('../public/demo/today.json', import.meta.url), JSON.stringify(feed, null, 2) + '\n');
