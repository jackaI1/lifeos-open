// Renders the systemd service that runs the Microsoft 365 sync on a schedule.
// install-timer.sh calls this, and test/timer.test.ts checks the output.
import {pathToFileURL} from 'node:url';

export interface UnitOptions {
  /** Absolute path of the LifeOS checkout that contains integrations/m365. */
  checkout: string;
  /** Account the job runs as. It needs read access to the checkout and to the database. */
  user: string;
  /** Absolute path of the Node.js binary (Node 24 or later). */
  node: string;
  /** Absolute path of the LifeOS SQLite workspace. The sync only reads it. */
  database: string;
  /** Directory for the token cache. It is the only writable path the job gets. */
  stateDir: string;
}

const SIMPLE_PATH = /^\/[A-Za-z0-9._\-/]+$/;

export function renderServiceUnit(options: UnitOptions): string {
  if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(options.user)) throw new Error('user must be a plain account name, such as jack');
  for (const key of ['checkout', 'node', 'database', 'stateDir'] as const) {
    const value = options[key];
    if (!SIMPLE_PATH.test(value)) throw new Error(`${key} must be an absolute path without spaces or quotes: ${value}`);
  }
  return [
    '[Unit]',
    'Description=Sync LifeOS coursework tasks to the SharePoint list',
    'Documentation=https://github.com/jackaI1/lifeos-open/blob/main/integrations/m365/README.md',
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=oneshot',
    `User=${options.user}`,
    `WorkingDirectory=${options.checkout}`,
    `Environment=LIFEOS_DATABASE=${options.database}`,
    `Environment=M365_TOKEN_CACHE=${options.stateDir}/m365-token-cache.json`,
    `EnvironmentFile=-${options.checkout}/.env`,
    `ExecStart=${options.node} ${options.checkout}/integrations/m365/src/cli.ts sync`,
    'TimeoutStartSec=10min',
    '# The job reads the workspace and writes only its token cache.',
    'NoNewPrivileges=true',
    'ProtectSystem=strict',
    `ReadWritePaths=${options.stateDir}`,
    'PrivateTmp=true',
    'PrivateDevices=true',
    'ProtectKernelTunables=true',
    'ProtectControlGroups=true',
    'RestrictSUIDSGID=true',
    'LockPersonality=true',
    'UMask=0077',
    '',
  ].join('\n');
}

// Timer unit: the same for every machine.
export const TIMER_UNIT = [
  '[Unit]',
  'Description=Run the LifeOS SharePoint sync every hour',
  '',
  '[Timer]',
  'OnCalendar=hourly',
  'RandomizedDelaySec=120',
  'Persistent=true',
  'Unit=lifeos-m365-sync.service',
  '',
  '[Install]',
  'WantedBy=timers.target',
  '',
].join('\n');

function argValue(argv: string[], name: string): string {
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  if (argv[0] === '--timer') {
    process.stdout.write(TIMER_UNIT);
  } else {
    process.stdout.write(renderServiceUnit({
      checkout: argValue(argv, '--checkout'),
      user: argValue(argv, '--user'),
      node: argValue(argv, '--node'),
      database: argValue(argv, '--database'),
      stateDir: argValue(argv, '--state-dir'),
    }));
  }
}
