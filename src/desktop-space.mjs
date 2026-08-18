import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

function createSpaceId(name) {
  const time = new Date().toISOString().replaceAll(/[-:.TZ]/g, '');
  return `${name}-${time}-${randomUUID().slice(0, 8)}`;
}

function validateName(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) throw new Error('Space name must be 1-64 letters, numbers, dots, underscores or hyphens');
}

async function runChild(executable, args, options, stdoutPath, stderrPath, timeoutMs) {
  const stdout = [], stderr = [];
  const child = spawn(executable, args, options);
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
  const result = await new Promise((resolveResult) => {
    child.once('error', (error) => resolveResult({ exitCode: null, signal: null, error }));
    child.once('exit', (exitCode, signal) => resolveResult({ exitCode, signal, error: null }));
  });
  clearTimeout(timer);
  await writeFile(stdoutPath, Buffer.concat(stdout), { mode: 0o600 });
  await writeFile(stderrPath, Buffer.concat(stderr), { mode: 0o600 });
  return { ...result, timedOut };
}

export async function runDesktopSpace({
  name = 'desktop-e2e', app, electronPath = process.env.SIGLOO_ELECTRON_PATH,
  args = [], invocationDirectory = process.cwd(), evidenceDirectory = '.sigloo/evidence', timeoutMs = 30_000,
} = {}) {
  validateName(name);
  if (!app) throw new Error('Desktop run requires --app');
  if (!electronPath) throw new Error('Desktop run requires --electron-path or SIGLOO_ELECTRON_PATH');
  await access(electronPath);
  const appPath = resolve(invocationDirectory, app);
  const id = createSpaceId(name);
  const startedAt = new Date().toISOString();
  const evidenceRoot = resolve(invocationDirectory, evidenceDirectory);
  const artifactRoot = join(evidenceRoot, `${id}-artifacts`);
  const logs = join(artifactRoot, 'logs');
  const userData = await mkdtemp(join(tmpdir(), 'sigloo-desktop-space-'));
  await mkdir(logs, { recursive: true, mode: 0o700 });
  const stdoutPath = join(logs, 'stdout.log');
  const stderrPath = join(logs, 'stderr.log');
  const evidencePath = join(evidenceRoot, `${id}.json`);
  let execution;
  let userDataRemoved = false;
  try {
    execution = await runChild(electronPath, [appPath, ...args], {
      cwd: resolve(invocationDirectory),
      env: { ...process.env, SIGLOO_SPACE_ID: id, SIGLOO_SPACE_DRIVER: 'desktop', SIGLOO_DESKTOP_USER_DATA_DIR: userData, SIGLOO_ARTIFACT_DIR: artifactRoot },
      stdio: ['ignore', 'pipe', 'pipe'],
    }, stdoutPath, stderrPath, timeoutMs);
  } finally {
    await rm(userData, { recursive: true, force: true });
    try { await access(userData); } catch { userDataRemoved = true; }
  }
  const passed = execution.exitCode === 0 && !execution.error && !execution.timedOut;
  const report = {
    schema_version: 1, space_id: id, name, driver: 'desktop', isolation_level: 'electron-user-data-and-space-artifacts',
    status: passed ? 'passed' : 'failed', started_at: startedAt, finished_at: new Date().toISOString(),
    desktop: { executable: basename(electronPath), app: appPath },
    result: { exit_code: execution.exitCode, signal: execution.signal, timed_out: execution.timedOut, spawn_error: execution.error?.code ?? null },
    failure: passed ? null : { step: 'desktop-process', category: execution.error || execution.timedOut ? 'driver' : 'test', exit_code: execution.exitCode, timed_out: execution.timedOut },
    artifacts: { root: artifactRoot, items: [{ kind: 'logs', path: stdoutPath }, { kind: 'logs', path: stderrPath }] },
    cleanup: { user_data_removed: userDataRemoved, resources_remaining: !userDataRemoved },
  };
  await mkdir(evidenceRoot, { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return { report, evidencePath };
}
