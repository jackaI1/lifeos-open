import {readFile} from 'node:fs/promises';
import {connect, migrate, publishFeed} from './store.ts';
// Deliberately fixed to the authored public fixture. No workspace path or upload input.
const feed = JSON.parse(await readFile(new URL('../../../public/demo/today.json', import.meta.url), 'utf8'));
const pool = await connect();
try {
  await migrate(pool);
  await publishFeed(pool, feed);
  console.log('Published the fictional public Today feed.');
} finally {await pool.close();}
