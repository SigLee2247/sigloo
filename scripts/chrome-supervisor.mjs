#!/usr/bin/env node

import { spawn } from 'node:child_process';

const [executable, ...arguments_] = process.argv.slice(2);
if (!executable) {
  process.stderr.write('chrome-supervisor: missing executable\n');
  process.exit(2);
}

const chrome = spawn(executable, arguments_, { stdio: ['ignore', 'ignore', 'pipe', 3, 4] });
chrome.stderr.pipe(process.stderr);
let stopping = false;

function stopChrome() {
  if (stopping || chrome.exitCode !== null) return;
  stopping = true;
  chrome.kill('SIGTERM');
  const force = setTimeout(() => { if (chrome.exitCode === null) chrome.kill('SIGKILL'); }, 3_000);
  force.unref();
}

process.stdin.resume();
process.stdin.once('end', stopChrome);
process.stdin.once('error', stopChrome);
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.once(signal, stopChrome);

chrome.once('error', (error) => {
  process.stderr.write(`chrome-supervisor: ${error.message}\n`);
  process.exitCode = 1;
});
chrome.once('exit', (code, signal) => {
  process.stdin.destroy();
  process.exitCode = signal ? 1 : (code ?? 1);
});
