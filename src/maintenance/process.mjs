import { spawn } from 'node:child_process';
import { basename, dirname, isAbsolute } from 'node:path';
import { PROTECTED_PATHS } from './policy.mjs';

export function maintenanceEnvironment(input = process.env, temporaryDirectory) {
  const env = {};
  const allowed = new Set(['systemroot', 'windir', 'comspec', 'path', 'pathext', 'userprofile', 'localappdata', 'appdata', 'home']);
  for (const [key, value] of Object.entries(input)) if (allowed.has(key.toLowerCase())) env[key] = value;
  if (temporaryDirectory) env.TEMP = env.TMP = env.TMPDIR = temporaryDirectory;
  env.GIT_CONFIG_NOSYSTEM = '1'; env.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null'; env.GIT_TERMINAL_PROMPT = '0';
  return env;
}

export async function runProcess(executable, args, { cwd, env = maintenanceEnvironment(), timeoutMs = 180000, input, signal, maxBytes = 4_000_000, allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    if (process.platform === 'win32' && /^node(?:\.exe)?$/i.test(basename(executable))) args = ['--preserve-symlinks', '--preserve-symlinks-main', ...args];
    const child = spawn(executable, args, { cwd, env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', stopped = false, settled = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (process.platform === 'win32' && child.pid) spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill());
      else child.kill();
    };
    const timer = setTimeout(stop, timeoutMs); signal?.addEventListener('abort', stop, { once: true });
    const clear = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); };
    child.stdout.on('data', b => { stdout += b.toString('utf8'); if (stdout.length + stderr.length > maxBytes) stop(); });
    child.stderr.on('data', b => { stderr += b.toString('utf8'); if (stdout.length + stderr.length > maxBytes) stop(); });
    child.stdin.on('error', () => {}); // A child that fails early can close its input before the bounded prompt finishes.
    child.on('error', () => { if (!settled) { settled = true; clear(); reject(new Error('Maintenance subprocess could not start')); } });
    child.on('close', code => {
      if (settled) return; settled = true; clear();
      if (stopped) { const error = new Error(signal?.aborted ? 'Maintenance cancelled' : 'Maintenance subprocess reached its limit'); error.code = signal?.aborted ? 'cancelled' : 'timeout'; reject(error); }
      else if (code && !allowFailure) { const error = new Error('Maintenance subprocess failed'); error.code = /usage limit|rate.limit|quota|usage_limit_reached/i.test(stderr) ? 'usage_limited' : 'process_failed'; error.exitCode = code; error.diagnostic = stderr.slice(-2000); reject(error); }
      else resolve({ code, stdout, stderr });
    });
    if (signal?.aborted) stop(); else child.stdin.end(input ?? '');
  });
}

/** Use the documented restricted profile for both generated commands and candidate tests. */
export function sandboxConfig({ nodeExe, worktree }) {
  if (!isAbsolute(nodeExe) || !isAbsolute(worktree)) throw new Error('Sandbox paths must be absolute');
  const fs = { ':root': 'deny', ':minimal': 'read', ':tmpdir': 'deny', ':slash_tmp': 'deny', [dirname(nodeExe).replaceAll('\\', '/')]: 'read', ':workspace_roots': { '.': 'write', '.git': 'deny', '.ai': 'deny', '.lifeos': 'deny', '.preflight-private': 'deny', 'node_modules': 'read', 'src/maintenance': 'read', 'src/server': 'read', 'src/runtime': 'read', 'tools': 'read', 'AGENTS.md': 'read', 'package.json': 'read', 'package-lock.json': 'read' } };
  for (const path of PROTECTED_PATHS) if (path !== 'test' && !path.startsWith('.')) fs[':workspace_roots'][path] = 'read';
  fs[':workspace_roots'].src = 'read';
  const toml = object => `{${Object.entries(object).map(([key,value]) => `${JSON.stringify(key)}=${typeof value === 'object' ? toml(value) : JSON.stringify(value)}`).join(',')}}`;
  return ['-c', 'permissions.lifeos-maintenance.extends=":workspace"', '-c', `permissions.lifeos-maintenance.filesystem=${toml(fs)}`, '-c', 'permissions.lifeos-maintenance.network.enabled=false', '-c', 'windows.sandbox="elevated"'];
}

export function sandboxRunner(){return async()=>{throw Error('Automatic maintenance execution is unavailable. Run reviewed checks manually.');};}
