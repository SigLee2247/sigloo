#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { once } from 'node:events';

const root = new URL('..', import.meta.url).pathname;

async function run(script, env = process.env) {
  const child = spawn(process.execPath, [`${root}scripts/${script}`], { cwd: root, env, stdio: 'inherit' });
  const [code, signal] = await once(child, 'exit');
  if (code !== 0 || signal) throw new Error(`${script} failed (${code ?? signal})`);
}

await run('release-gate.mjs');
const desktopConfigured = Boolean(process.env.SIGLOO_DESKTOP_APP && process.env.SIGLOO_ELECTRON_PATH);
if (desktopConfigured) {
  await run('desktop-release-gate.mjs', { ...process.env, SIGLOO_DESKTOP_TERMINAL: process.env.SIGLOO_DESKTOP_TERMINAL ?? '1', SIGLOO_DESKTOP_IPC: process.env.SIGLOO_DESKTOP_IPC ?? '1' });
} else {
  process.stdout.write(`${JSON.stringify({ desktop_gate: 'skipped', reason: 'SIGLOO_DESKTOP_APP and SIGLOO_ELECTRON_PATH are not set' }, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify({ status: 'passed', browser_process_gate: 'passed', desktop_gate: desktopConfigured ? 'passed' : 'skipped' }, null, 2)}\n`);
