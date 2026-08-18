import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { randomInt } from 'node:crypto';
import { pathToFileURL } from 'node:url';

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

async function inspectRenderer(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let targets = [];
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      targets = await response.json();
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page) {
        const socket = new WebSocket(page.webSocketDebuggerUrl);
        const result = await new Promise((resolveResult, reject) => {
          const timer = setTimeout(() => reject(new Error('Renderer inspection timed out')), 3_000);
          socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: 'document.title' } })));
          socket.addEventListener('message', (event) => {
            const message = JSON.parse(event.data);
            if (message.id === 1) { clearTimeout(timer); resolveResult(message.result?.result?.value ?? null); socket.close(); }
          });
          socket.addEventListener('error', reject);
        });
        return { targets, page_url: page.url, title: result };
      }
    } catch { /* app is still starting */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  return { targets, page_url: null, title: null };
}

async function cdpCall(target, method, params = {}) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  return new Promise((resolveResult, reject) => {
    const timer = setTimeout(() => reject(new Error('Desktop CDP call timed out')), 3_000);
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method, params })));
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timer); socket.close();
      if (message.error) reject(new Error(message.error.message)); else resolveResult(message.result);
    });
    socket.addEventListener('error', reject);
  });
}

async function loadDesktopScript(path, invocationDirectory) {
  const absolutePath = resolve(invocationDirectory, path);
  const metadata = await lstat(absolutePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('Desktop test script must be a regular file');
  const module = await import(`${pathToFileURL(absolutePath).href}?sigloo=${Date.now()}`);
  if (typeof module.default !== 'function') throw new Error('Desktop test script must export a default function');
  return module.default;
}

export async function runDesktopSpace({
  name = 'desktop-e2e', app, electronPath = process.env.SIGLOO_ELECTRON_PATH,
  args = [], script, invocationDirectory = process.cwd(), evidenceDirectory = '.sigloo/evidence', timeoutMs = 30_000,
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
  const remoteDebuggingPort = randomInt(40_000, 49_000);
  let renderer = { targets: [], page_url: null, title: null };
  const assertions = [];
  const actions = [];
  const artifacts = [];
  let scriptFailure = null;
  let userDataRemoved = false;
  try {
    const childPromise = runChild(electronPath, [`--remote-debugging-port=${remoteDebuggingPort}`, appPath, ...args], {
      cwd: resolve(invocationDirectory),
      env: { ...process.env, SIGLOO_SPACE_ID: id, SIGLOO_SPACE_DRIVER: 'desktop', SIGLOO_DESKTOP_USER_DATA_DIR: userData, SIGLOO_ARTIFACT_DIR: artifactRoot },
      stdio: ['ignore', 'pipe', 'pipe'],
    }, stdoutPath, stderrPath, timeoutMs);
    renderer = await inspectRenderer(remoteDebuggingPort, Math.min(timeoutMs, 1_000));
    if (script) {
      const target = renderer.targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
      if (!target) throw new Error('Desktop renderer target was not found');
      const runScript = await loadDesktopScript(script, invocationDirectory);
      const api = Object.freeze({
        spaceId: id,
        windows: () => renderer.targets.map((item) => ({ id: item.id, type: item.type, url: item.url, title: item.title })),
        evaluate: async (expression) => {
          if (typeof expression !== 'string' || expression.length > 50_000) throw new Error('Desktop evaluate expression is invalid');
          actions.push({ action: 'evaluate', at: new Date().toISOString() });
          return (await cdpCall(target, 'Runtime.evaluate', { expression, returnByValue: true })).result?.value ?? null;
        },
        assert(assertionName, condition) {
          validateName(assertionName, 'Assertion name');
          const passed = condition === true; assertions.push({ name: assertionName, passed });
          if (!passed) throw new Error('Named desktop assertion failed');
        },
        screenshot: async (artifactName) => {
          validateName(artifactName, 'Artifact name');
          const capture = await cdpCall(target, 'Page.captureScreenshot', { format: 'png' });
          const path = join(artifactRoot, `${artifactName}.png`);
          await writeFile(path, Buffer.from(capture.data, 'base64'), { mode: 0o600 });
          artifacts.push({ name: artifactName, path, media_type: 'image/png' });
          return path;
        },
      });
      try { await runScript(api); } catch (error) { scriptFailure = { type: error?.name ?? 'Error', message: error?.message ?? 'Desktop script failed' }; }
    }
    execution = await childPromise;
  } finally {
    await rm(userData, { recursive: true, force: true });
    try { await access(userData); } catch { userDataRemoved = true; }
  }
  const passed = execution.exitCode === 0 && !execution.error && !execution.timedOut && !scriptFailure;
  const report = {
    schema_version: 1, space_id: id, name, driver: 'desktop', isolation_level: 'electron-user-data-and-space-artifacts',
    status: passed ? 'passed' : 'failed', started_at: startedAt, finished_at: new Date().toISOString(),
    desktop: { executable: basename(electronPath), app: appPath, remote_debugging_port: remoteDebuggingPort, renderer },
    result: { exit_code: execution.exitCode, signal: execution.signal, timed_out: execution.timedOut, spawn_error: execution.error?.code ?? null },
    failure: passed ? null : scriptFailure ?? { step: 'desktop-process', category: execution.error || execution.timedOut ? 'driver' : 'test', exit_code: execution.exitCode, timed_out: execution.timedOut },
    test: { assertions, actions },
    artifacts: { root: artifactRoot, items: [{ kind: 'logs', path: stdoutPath }, { kind: 'logs', path: stderrPath }, ...artifacts] },
    cleanup: { user_data_removed: userDataRemoved, resources_remaining: !userDataRemoved },
  };
  await mkdir(evidenceRoot, { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return { report, evidencePath };
}
