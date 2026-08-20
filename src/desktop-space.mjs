import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { randomInt } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { writeRunReports } from './report-renderer.mjs';

function createSpaceId(name) {
  const time = new Date().toISOString().replaceAll(/[-:.TZ]/g, '');
  return `${name}-${time}-${randomUUID().slice(0, 8)}`;
}

function validateName(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) throw new Error('Space name must be 1-64 letters, numbers, dots, underscores or hyphens');
}

function desktopEnvironment(spaceId, userData, artifactRoot) {
  const environment = { ...process.env };
  if (process.env.SIGLOO_ALLOW_SENSITIVE_ENV !== '1') {
    for (const key of Object.keys(environment)) {
      if (/(TOKEN|PASSWORD|SECRET|PRIVATE_KEY|API_KEY|AUTHORIZATION)/i.test(key)) delete environment[key];
    }
  }
  return { ...environment, SIGLOO_SPACE_ID: spaceId, SIGLOO_SPACE_DRIVER: 'desktop', SIGLOO_DESKTOP_MODE: 'offscreen', SIGLOO_DESKTOP_CLIPBOARD_MODE: 'isolated', SIGLOO_DESKTOP_USER_DATA_DIR: userData, SIGLOO_ARTIFACT_DIR: artifactRoot };
}

async function runChild(executable, args, options, stdoutPath, stderrPath, timeoutMs, onSpawn = () => {}) {
  const stdout = [], stderr = [];
  const child = spawn(executable, args, options);
  onSpawn(child);
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  let timedOut = false;
  let escalationTimer;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    escalationTimer = setTimeout(() => child.kill('SIGKILL'), 2_000);
  }, timeoutMs);
  const result = await new Promise((resolveResult) => {
    child.once('error', (error) => resolveResult({ exitCode: null, signal: null, error }));
    child.once('exit', (exitCode, signal) => resolveResult({ exitCode, signal, error: null }));
  });
  clearTimeout(timer);
  if (escalationTimer) clearTimeout(escalationTimer);
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
  let childProcess = null;
  let userDataRemoved = false;
  try {
    const childPromise = runChild(electronPath, [`--remote-debugging-port=${remoteDebuggingPort}`, appPath, ...args], {
      cwd: resolve(invocationDirectory),
      env: desktopEnvironment(id, userData, artifactRoot),
      stdio: ['ignore', 'pipe', 'pipe'],
    }, stdoutPath, stderrPath, timeoutMs, (child) => { childProcess = child; });
    renderer = await inspectRenderer(remoteDebuggingPort, Math.min(timeoutMs, 5_000));
    if (script) {
      let target = renderer.targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
      if (!target) throw new Error('Desktop renderer target was not found');
      const runScript = await loadDesktopScript(script, invocationDirectory);
      const api = Object.freeze({
        spaceId: id,
        windows: () => renderer.targets.map((item) => ({ id: item.id, type: item.type, url: item.url, title: item.title })),
        useWindow: (windowId) => {
          const selected = renderer.targets.find((item) => item.id === windowId && item.webSocketDebuggerUrl);
          if (!selected) throw new Error('Desktop window target was not found');
          target = selected;
          actions.push({ action: 'useWindow', target: windowId, at: new Date().toISOString() });
        },
        evaluate: async (expression) => {
          if (typeof expression !== 'string' || expression.length > 50_000) throw new Error('Desktop evaluate expression is invalid');
          actions.push({ action: 'evaluate', at: new Date().toISOString() });
          return (await cdpCall(target, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value ?? null;
        },
        click: async (selector) => {
          if (typeof selector !== 'string' || selector.length > 1_000) throw new Error('Desktop selector is invalid');
          actions.push({ action: 'click', target: selector, at: new Date().toISOString() });
          return (await cdpCall(target, 'Runtime.evaluate', { expression: `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw new Error('Desktop element not found'); element.click(); return true; })()`, returnByValue: true })).result?.value ?? false;
        },
        fill: async (selector, value) => {
          if (typeof selector !== 'string' || selector.length > 1_000 || typeof value !== 'string' || value.length > 100_000) throw new Error('Desktop fill input is invalid');
          actions.push({ action: 'fill', target: selector, at: new Date().toISOString() });
          const expression = `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw new Error('Desktop element not found'); element.focus(); element.value = ${JSON.stringify(value)}; element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`;
          return (await cdpCall(target, 'Runtime.evaluate', { expression, returnByValue: true })).result?.value ?? false;
        },
        key: async (selector, key) => {
          if (typeof selector !== 'string' || selector.length > 1_000 || typeof key !== 'string' || key.length > 32) throw new Error('Desktop key input is invalid');
          actions.push({ action: 'key', target: selector, at: new Date().toISOString() });
          await cdpCall(target, 'Runtime.evaluate', { expression: `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw new Error('Desktop element not found'); element.focus(); return true; })()`, returnByValue: true });
          await cdpCall(target, 'Input.dispatchKeyEvent', { type: 'keyDown', key, code: key });
          await cdpCall(target, 'Input.dispatchKeyEvent', { type: 'keyUp', key, code: key });
          return true;
        },
        keyChord: async (keys) => {
          if (!Array.isArray(keys) || keys.length < 1 || keys.length > 4 || keys.some((key) => typeof key !== 'string' || key.length > 32)) throw new Error('Desktop key chord is invalid');
          actions.push({ action: 'keyChord', key_count: keys.length, at: new Date().toISOString() });
          const modifiers = keys.reduce((mask, key) => mask | ({ Alt: 1, Control: 2, Meta: 4, Shift: 8 }[key] ?? 0), 0);
          const mainKey = keys.at(-1);
          await cdpCall(target, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: mainKey, code: mainKey, modifiers });
          await cdpCall(target, 'Input.dispatchKeyEvent', { type: 'keyUp', key: mainKey, code: mainKey, modifiers });
          return true;
        },
        clickAt: async (x, y) => {
          if (![x, y].every((value) => Number.isFinite(value) && value >= 0)) throw new Error('Desktop click coordinates are invalid');
          actions.push({ action: 'clickAt', at: new Date().toISOString() });
          await cdpCall(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
          await cdpCall(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
          return true;
        },
        drag: async (from, to) => {
          if (![from?.x, from?.y, to?.x, to?.y].every((value) => Number.isFinite(value) && value >= 0)) throw new Error('Desktop drag coordinates are invalid');
          actions.push({ action: 'drag', at: new Date().toISOString() });
          await cdpCall(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1 });
          await cdpCall(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: to.x, y: to.y, button: 'left' });
          await cdpCall(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', clickCount: 1 });
          return true;
        },
        type: async (selector, value) => {
          if (typeof selector !== 'string' || selector.length > 1_000 || typeof value !== 'string' || value.length > 100_000) throw new Error('Desktop type input is invalid');
          actions.push({ action: 'type', target: selector, at: new Date().toISOString() });
          await cdpCall(target, 'Runtime.evaluate', { expression: `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw new Error('Desktop element not found'); element.focus(); return true; })()`, returnByValue: true });
          await cdpCall(target, 'Input.insertText', { text: value });
          return true;
        },
        crashRenderer: async () => {
          actions.push({ action: 'crashRenderer', at: new Date().toISOString() });
          await cdpCall(target, 'Page.crash');
        },
        close: () => {
          actions.push({ action: 'close', at: new Date().toISOString() });
          childProcess?.kill('SIGTERM');
          setTimeout(() => childProcess?.kill('SIGKILL'), 2_000).unref();
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
        reload: async () => {
          actions.push({ action: 'reload', at: new Date().toISOString() });
          await cdpCall(target, 'Page.reload', { ignoreCache: true });
        },
      });
      try { await runScript(api); } catch (error) {
        scriptFailure = { type: error?.name ?? 'Error', message: error?.message ?? 'Desktop script failed' };
        childProcess?.kill('SIGTERM');
        setTimeout(() => childProcess?.kill('SIGKILL'), 2_000).unref();
      }
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
    desktop: { executable: basename(electronPath), app: appPath, remote_debugging_port: remoteDebuggingPort, renderer, environment_policy: process.env.SIGLOO_ALLOW_SENSITIVE_ENV === '1' ? 'explicit-sensitive-env-opt-in' : 'sensitive-env-redacted' },
    result: { exit_code: execution.exitCode, signal: execution.signal, timed_out: execution.timedOut, spawn_error: execution.error?.code ?? null },
    failure: passed ? null : scriptFailure ?? { step: 'desktop-process', category: execution.error || execution.timedOut ? 'driver' : 'test', exit_code: execution.exitCode, timed_out: execution.timedOut },
    test: {
      title: `${name} Desktop Space 실행 검증`,
      purpose: `화면에 창을 띄우지 않는 offscreen Electron Space에서 ${appPath}의 renderer·UI·IPC·종료 동작을 확인한다.`,
      preconditions: ['Electron executable과 앱 경로가 존재한다.', '앱이 SIGLOO_DESKTOP_MODE=offscreen 계약을 지원한다.'],
      steps: ['임시 userData 및 remote debugging endpoint 생성', 'Electron 앱 offscreen 실행', 'renderer target 선택 및 script action/assert 실행', 'SIGTERM/SIGKILL escalation과 userData cleanup 확인'],
      success_criteria: ['script assertion이 모두 통과한다.', '앱이 정상 종료되거나 bounded failure로 수렴한다.', 'resources_remaining이 false이다.'],
      assertions, actions,
    },
    artifacts: { root: artifactRoot, items: [{ kind: 'logs', path: stdoutPath }, { kind: 'logs', path: stderrPath }, ...artifacts] },
    cleanup: { user_data_removed: userDataRemoved, resources_remaining: !userDataRemoved },
  };
  const reportPaths = await writeRunReports(report, evidenceRoot, evidencePath);
  return { report, ...reportPaths };
}
