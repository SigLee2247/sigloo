#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDesktopSpace } from '../src/desktop-space.mjs';

const app = process.env.SIGLOO_DESKTOP_APP;
const electronPath = process.env.SIGLOO_ELECTRON_PATH;
if (!app || !electronPath) throw new Error('SIGLOO_DESKTOP_APP and SIGLOO_ELECTRON_PATH are required');

const root = await mkdtemp(join(tmpdir(), 'sigloo-desktop-gate-'));
const script = join(root, 'smoke.mjs');
const evidenceDirectory = join(root, 'evidence');
await writeFile(script, `export default async function (desktop) {
  const page = desktop.windows().find((window) => window.type === 'page' && window.url.endsWith('index.html'));
  desktop.assert('renderer-present', Boolean(page));
  desktop.useWindow(page.id);
  let ready = 'loading';
  for (let attempt = 0; attempt < 20 && ready !== 'complete'; attempt += 1) {
    ready = await desktop.evaluate('document.readyState');
    if (ready !== 'complete') await new Promise((resolve) => setTimeout(resolve, 250));
  }
  desktop.assert('document-ready', ready === 'complete');
  if (process.env.SIGLOO_DESKTOP_TERMINAL === '1') {
    let terminalReady = false;
    for (let attempt = 0; attempt < 20 && !terminalReady; attempt += 1) {
      terminalReady = await desktop.evaluate('document.querySelectorAll(".xterm-helper-textarea").length > 0');
      if (!terminalReady) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    desktop.assert('terminal-ready', terminalReady);
    await desktop.click('.xterm-helper-textarea');
    await desktop.type('.xterm-helper-textarea', 'printf SIGLOO_GATE');
    await desktop.key('.xterm-helper-textarea', 'Enter');
    await new Promise((resolve) => setTimeout(resolve, 500));
    desktop.assert('terminal-output', (await desktop.evaluate('document.querySelector(".xterm-rows")?.innerText ?? ""')).includes('SIGLOO_GATE'));
  }
  if (process.env.SIGLOO_DESKTOP_IPC === '1') {
    const fontSize = await desktop.evaluate('window.sigterm.invoke("config:get", { key: "terminal.fontSize", fallback: 13 })');
    desktop.assert('config-ipc', typeof fontSize === 'number');
  }
  await desktop.screenshot('initial');
  desktop.close();
}\n`);

const runs = [];
for (let index = 0; index < Number(process.env.SIGLOO_DESKTOP_GATE_RUNS ?? 3); index += 1) {
  const result = await runDesktopSpace({ name: `desktop-gate-${index}`, app, electronPath, script, invocationDirectory: process.cwd(), evidenceDirectory, timeoutMs: 30_000 });
  if (result.report.status !== 'passed') process.stderr.write(`${JSON.stringify({ failure: result.report.failure, test: result.report.test, cleanup: result.report.cleanup }, null, 2)}\n`);
  assert.equal(result.report.status, 'passed');
  assert.equal(result.report.cleanup.resources_remaining, false);
  runs.push(result.report.space_id);
}
process.stdout.write(`${JSON.stringify({ status: 'passed', desktop_runs: runs.length, unique_spaces: new Set(runs).size, resources_remaining: false }, null, 2)}\n`);
