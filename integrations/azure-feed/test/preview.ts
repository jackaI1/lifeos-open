import {readFile} from 'node:fs/promises';
import {withEmulators} from './emulators.ts';
import {connect, publishFeed} from '../src/store.ts';

try {
  await withEmulators(async ({url}) => {
    const pool = await connect();
    try {await publishFeed(pool, JSON.parse(await readFile(new URL('../../../public/demo/today.json', import.meta.url), 'utf8')));}
    finally {await pool.close();}
    console.log(`Today feed: ${url}/api/demo/today\nReadiness: ${url}/api/health\nCtrl-C stops the owned host, Azurite and SQL container.`);
    await new Promise<void>(() => {});
  });
} catch (error) {
  if (!(error instanceof Error && error.message === 'Interrupted')) throw error;
}
