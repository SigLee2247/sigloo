import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { runProcessSpace } from '../src/process-space.mjs';

const execFileAsync = promisify(execFile);
const cli = new URL('../bin/sigloo.mjs', import.meta.url).pathname;

test('doctor reports available drivers as JSON', async () => {
  const { stdout } = await execFileAsync(process.execPath, [cli, 'doctor', '--json']);
  const report = JSON.parse(stdout);
  assert.equal(report.platform, process.platform);
  assert.equal(report.drivers.process, 'prototype');
  assert.equal(typeof report.chrome.available, 'boolean');
});

test('run creates evidence and removes the Process Space directory', async () => {
  const invocationDirectory = await mkdtemp(join(tmpdir(), 'sigloo-cli-test-'));
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      cli, 'run', '--name', 'cli-e2e', '--', process.execPath, '-e',
      "process.stdout.write(process.env.SIGLOO_SPACE_ID ? 'child-ok\\n' : 'missing-space\\n')",
    ], { cwd: invocationDirectory });
    assert.match(stdout, /child-ok/);
    const receiptLine = stdout.split('\n').find((line) => line.startsWith('SIGLOO_RECEIPT '));
    assert.ok(receiptLine);
    const receipt = JSON.parse(receiptLine.slice('SIGLOO_RECEIPT '.length));
    assert.deepEqual(receipt.cleanup, {
      temporary_directory_removed: true,
      resources_remaining: false,
    });

    const evidenceDirectory = join(invocationDirectory, '.sigloo', 'evidence');
    const evidenceFiles = await readdir(evidenceDirectory);
    assert.equal(evidenceFiles.length, 1);
    const report = JSON.parse(await readFile(join(evidenceDirectory, evidenceFiles[0]), 'utf8'));
    assert.equal(report.space_id, receipt.space_id);
    assert.equal(report.status, 'passed');
    assert.equal(report.isolation_level, 'temporary-working-directory');
    assert.equal(report.cleanup.resources_remaining, false);
  } finally {
    await rm(invocationDirectory, { recursive: true, force: true });
  }
});

test('failed commands still produce private evidence and a clean receipt', async () => {
  const invocationDirectory = await mkdtemp(join(tmpdir(), 'sigloo-cli-failure-test-'));
  try {
    const { report, evidencePath } = await runProcessSpace({
      name: 'expected-failure',
      command: process.execPath,
      args: ['-e', 'process.exit(7)', 'sensitive-placeholder'],
      invocationDirectory,
      stdio: 'ignore',
    });
    assert.equal(report.status, 'failed');
    assert.equal(report.result.exit_code, 7);
    assert.equal(report.cleanup.resources_remaining, false);
    const serialized = await readFile(evidencePath, 'utf8');
    assert.doesNotMatch(serialized, /sensitive-placeholder/);
  } finally {
    await rm(invocationDirectory, { recursive: true, force: true });
  }
});
