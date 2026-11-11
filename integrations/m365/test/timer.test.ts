import test from 'node:test';
import assert from 'node:assert/strict';
import {renderServiceUnit, TIMER_UNIT, type UnitOptions} from '../src/timer-unit.ts';

const options: UnitOptions = {
  checkout: '/opt/lifeos-src',
  user: 'lifeos',
  node: '/usr/bin/node',
  database: '/var/lib/lifeos/workspace.sqlite',
  stateDir: '/var/lib/lifeos-m365',
};

const directives = (unit: string) => new Map(
  unit.split('\n').filter((line) => line.includes('=') && !line.startsWith('#')).map((line) => {
    const index = line.indexOf('=');
    return [line.slice(0, index), line.slice(index + 1)] as const;
  }),
);

test('the service runs the sync from the checkout as the chosen user', () => {
  const unit = directives(renderServiceUnit(options));
  assert.equal(unit.get('User'), 'lifeos');
  assert.equal(unit.get('WorkingDirectory'), '/opt/lifeos-src');
  assert.equal(unit.get('ExecStart'), '/usr/bin/node /opt/lifeos-src/integrations/m365/src/cli.ts sync');
  assert.equal(unit.get('Type'), 'oneshot');
});

test('the job reads the workspace and may write only its token cache', () => {
  const text = renderServiceUnit(options);
  assert.match(text, /^Environment=LIFEOS_DATABASE=\/var\/lib\/lifeos\/workspace\.sqlite$/m);
  assert.match(text, /^Environment=M365_TOKEN_CACHE=\/var\/lib\/lifeos-m365\/m365-token-cache\.json$/m);
  assert.match(text, /^ProtectSystem=strict$/m);
  assert.match(text, /^ReadWritePaths=\/var\/lib\/lifeos-m365$/m);
  assert.match(text, /^NoNewPrivileges=true$/m);
});

test('the .env file is optional, so a missing file does not stop the job', () => {
  assert.match(renderServiceUnit(options), /^EnvironmentFile=-\/opt\/lifeos-src\/\.env$/m);
});

test('paths and user names that could break the unit are refused', () => {
  assert.throws(() => renderServiceUnit({...options, checkout: 'relative/path'}), /absolute path/);
  assert.throws(() => renderServiceUnit({...options, database: '/var/lib/my db.sqlite'}), /absolute path/);
  assert.throws(() => renderServiceUnit({...options, node: '/usr/bin/node\nExecStartPre=/bin/sh'}), /absolute path/);
  assert.throws(() => renderServiceUnit({...options, user: 'Root User'}), /plain account name/);
});

test('the timer runs hourly with a small random delay and catches up after downtime', () => {
  const timer = directives(TIMER_UNIT);
  assert.equal(timer.get('OnCalendar'), 'hourly');
  assert.equal(timer.get('Persistent'), 'true');
  assert.equal(timer.get('RandomizedDelaySec'), '120');
  assert.equal(timer.get('Unit'), 'lifeos-m365-sync.service');
  assert.equal(timer.get('WantedBy'), 'timers.target');
});
