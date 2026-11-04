import {existsSync} from 'node:fs';
import {loadConfig} from './config.ts';
import {createMsalApp, GRAPH_SCOPES, loginWithDeviceCode, signOut, silentTokenProvider} from './auth.ts';
import {GraphClient} from './graph-client.ts';
import {readLifeos} from './lifeos-source.ts';
import {resolveSite, syncTasks} from './sync.ts';

const USAGE = `LifeOS Microsoft 365 sync

  npm run m365 -- login              Sign in with a device code (opens nothing automatically)
  npm run m365 -- whoami             Show the signed-in account
  npm run m365 -- sync [--dry-run] [--prune] [--force]
                                     Push LifeOS tasks to the SharePoint list
  npm run m365 -- logout             Delete the cached sign-in
`;

async function main(argv: string[]): Promise<number> {
  const [command, ...flags] = argv;
  const known = new Set(['--dry-run', '--prune', '--force']);
  const unknown = flags.filter((flag) => !known.has(flag));
  if (!command || command === 'help' || command === '--help' || unknown.length) {
    console.log(USAGE);
    return command && command !== 'help' && command !== '--help' ? 2 : 0;
  }
  if (command === 'logout') {
    await signOut(loadConfig().cachePath);
    console.log('Signed out. The cached token file was deleted.');
    return 0;
  }
  if (!['login', 'whoami', 'sync'].includes(command)) {
    console.log(USAGE);
    return 2;
  }
  const config = loadConfig(process.env, command === 'sync' ? ['clientId', 'siteUrl'] : ['clientId']);
  const app = await createMsalApp(config);

  if (command === 'login') {
    const account = await loginWithDeviceCode(app, GRAPH_SCOPES, (prompt) => console.log(`\n${prompt.message}\n`));
    console.log(`Signed in as ${account.username}. Token cache: ${config.cachePath}`);
    return 0;
  }

  const client = new GraphClient({
    getToken: silentTokenProvider(app),
    onRetry: (info) => console.warn(`  Graph busy (${info.reason}); retry ${info.attempt} in ${(info.delayMs / 1000).toFixed(1)}s`),
  });
  if (command === 'whoami') {
    const me = await client.me();
    console.log(`${me.displayName ?? ''} <${me.userPrincipalName ?? me.id}>`.trim());
    return 0;
  }

  if (!existsSync(config.lifeosDatabase)) throw new Error(`LifeOS database not found at ${config.lifeosDatabase}. Set LIFEOS_DATABASE.`);
  const snapshot = readLifeos(config.lifeosDatabase);
  const site = await resolveSite(client, config.siteUrl);
  const result = await syncTasks(client, site, snapshot.tasks, {
    listName: config.listName,
    dryRun: flags.includes('--dry-run'),
    prune: flags.includes('--prune'),
    force: flags.includes('--force'),
    timeZone: config.timeZone ?? snapshot.timeZone,
    log: (line) => console.log(`  ${line}`),
  });
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
