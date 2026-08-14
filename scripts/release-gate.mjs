#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { access, chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { runBrowserTestSpace } from '../src/browser-run.mjs';
import { setupSigloo } from '../src/setup.mjs';

const execFileAsync = promisify(execFile);
const cli = new URL('../bin/sigloo.mjs', import.meta.url).pathname;
const installer = new URL('./install-local.mjs', import.meta.url).pathname;

async function supervisorProcesses() {
  const { stdout } = await execFileAsync('/bin/ps', ['-axo', 'pid=,command=']);
  return stdout.split('\n').filter((line) => line.includes('scripts/chrome-supervisor.mjs')).map((line) => line.trim());
}

async function waitFor(predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error('release gate wait timed out');
}

const root = await mkdtemp(join(tmpdir(), 'sigloo-release-gate-'));
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><title>Sigloo release gate</title><button id="ready">Ready</button>');
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = join(root, 'auth.json');
const smokeScript = join(root, 'smoke.mjs');
const evidence = join(root, 'evidence');
const baselineSupervisors = await supervisorProcesses();
let report;

try {
  await writeFile(profile, `${JSON.stringify({ schema_version: 1, origin, cookies: [], local_storage: { baseline: 'yes' } })}\n`, { mode: 0o600 });
  await chmod(profile, 0o600);
  await writeFile(smokeScript, `export default async function (page) {
    page.assert('baseline', await page.getLocalStorage('baseline') === 'yes');
    const snapshot = await page.snapshot();
    page.assert('ready-button', snapshot.elements.some((element) => element.name === 'Ready'));
  }\n`);

  const sequential = [];
  for (let index = 0; index < 100; index += 1) {
    const result = await runBrowserTestSpace({
      name: `release-${index}`, url: `${origin}/`, script: smokeScript, authProfile: profile,
      invocationDirectory: root, evidenceDirectory: evidence, timeoutMs: 20_000,
    });
    assert.equal(result.report.status, 'passed');
    assert.equal(result.report.cleanup.resources_remaining, false);
    sequential.push(result.report.space_id);
  }
  assert.equal(new Set(sequential).size, 100);

  const concurrentScripts = [];
  for (const id of ['alpha', 'beta']) {
    const path = join(root, `${id}.mjs`);
    await writeFile(path, `export default async function (page) {
      page.assert('clean-start', await page.getLocalStorage('concurrent') === null);
      await page.setLocalStorage('concurrent', ${JSON.stringify(id)});
      await new Promise((resolve) => setTimeout(resolve, 150));
      page.assert('own-state', await page.getLocalStorage('concurrent') === ${JSON.stringify(id)});
    }\n`);
    concurrentScripts.push(path);
  }
  const concurrent = await Promise.all(concurrentScripts.map((script, index) => runBrowserTestSpace({
    name: `concurrent-${index}`, url: `${origin}/`, script, authProfile: profile,
    invocationDirectory: root, evidenceDirectory: evidence, timeoutMs: 20_000,
  })));
  assert.equal(new Set(concurrent.map(({ report: item }) => item.space_id)).size, 2);
  assert.ok(concurrent.every(({ report: item }) => item.status === 'passed' && !item.cleanup.resources_remaining));

  const hanging = join(root, 'hanging.mjs');
  await writeFile(hanging, 'export default async function () { await new Promise(() => {}); }\n');
  const beforeTemporary = new Set((await readdir(tmpdir())).filter((name) => name.startsWith('sigloo-browser-run-')));
  const crashed = spawn(process.execPath, [cli, 'browser', 'run', '--url', `${origin}/`, '--script', hanging, '--auth-profile', profile, '--timeout-ms', '300000'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const orphanName = await waitFor(async () => (await readdir(tmpdir())).find((name) => name.startsWith('sigloo-browser-run-') && !beforeTemporary.has(name)));
  await waitFor(async () => (await supervisorProcesses()).length > baselineSupervisors.length);
  crashed.kill('SIGKILL');
  await once(crashed, 'exit');
  await waitFor(async () => (await supervisorProcesses()).length === baselineSupervisors.length);
  process.env.SIGLOO_DATA_ROOT = join(root, 'data');
  const setup = await setupSigloo();
  assert.ok(setup.recovery.recovered >= 1);
  await assert.rejects(access(join(tmpdir(), orphanName)));

  const installRoot = join(root, 'install');
  const binDirectory = join(root, 'bin');
  const args = ['install', '--install-root', installRoot, '--bin-dir', binDirectory];
  const first = JSON.parse((await execFileAsync(process.execPath, [installer, ...args])).stdout);
  const second = JSON.parse((await execFileAsync(process.execPath, [installer, ...args])).stdout);
  assert.equal(first.digest, second.digest);
  await execFileAsync(join(binDirectory, 'sigloo'), ['setup', '--json'], { env: { ...process.env, SIGLOO_DATA_ROOT: join(root, 'installed-data') } });
  await execFileAsync(process.execPath, [installer, 'uninstall', '--install-root', installRoot, '--bin-dir', binDirectory]);
  await assert.rejects(access(join(binDirectory, 'sigloo')));
  await access(first.release);

  report = {
    status: 'passed', browser_runs: sequential.length, concurrent_spaces: concurrent.length,
    crash_recovery: { watchdog_processes_remaining: 0, temporary_profiles_recovered: setup.recovery.recovered },
    install_lifecycle: 'passed', resources_remaining: false,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  server.close();
  await once(server, 'close');
  await rm(root, { recursive: true, force: true });
}
