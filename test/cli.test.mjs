import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
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
      space_preserved: false,
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

test('persistent Space reconnects across CLI processes and enforces ownership', async () => {
  const invocationDirectory = await mkdtemp(join(tmpdir(), 'sigloo-space-lifecycle-test-'));
  const dataRoot = join(invocationDirectory, 'data');
  const env = { ...process.env, SIGLOO_DATA_ROOT: dataRoot, SIGLOO_OWNER_ID: 'agent-alpha' };
  try {
    const created = await execFileAsync(process.execPath, [cli, 'create', 'checkout', '--ttl', '5m', '--json'], { env });
    const space = JSON.parse(created.stdout);
    assert.equal(space.name, 'checkout');
    assert.equal(space.owner_id, 'agent-alpha');
    assert.equal(space.state, 'ready');

    const run = await execFileAsync(process.execPath, [
      cli, 'run', space.id, '--', process.execPath, '-e',
      "process.stdout.write(process.cwd() === process.env.SIGLOO_SPACE_DIR ? 'persistent-ok\\n' : 'wrong-dir\\n')",
    ], { env });
    assert.match(run.stdout, /persistent-ok/);
    const receiptLine = run.stdout.split('\n').find((line) => line.startsWith('SIGLOO_RECEIPT '));
    const receipt = JSON.parse(receiptLine.slice('SIGLOO_RECEIPT '.length));
    assert.equal(receipt.cleanup.space_preserved, true);
    assert.equal(receipt.cleanup.resources_remaining, false);

    const inspected = JSON.parse((await execFileAsync(process.execPath, [cli, 'inspect', space.id, '--json'], { env })).stdout);
    assert.equal(inspected.id, space.id);
    assert.equal(inspected.last_run.status, 'passed');

    await assert.rejects(
      execFileAsync(process.execPath, [cli, 'inspect', space.id, '--json'], {
        env: { ...env, SIGLOO_OWNER_ID: 'agent-beta' },
      }),
      (error) => error.code === 3 && JSON.parse(error.stderr).error.code === 'SPACE_OWNER_MISMATCH',
    );

    const completed = JSON.parse((await execFileAsync(process.execPath, [cli, 'complete', space.id, '--json'], { env })).stdout);
    assert.equal(completed.state, 'completed');
    await assert.rejects(
      execFileAsync(process.execPath, [cli, 'run', space.id, '--', process.execPath, '-e', 'process.exit(0)'], { env }),
      (error) => error.code === 5 && /not runnable/.test(error.stderr),
    );

    const destroyed = JSON.parse((await execFileAsync(process.execPath, [cli, 'destroy', space.id, '--json'], { env })).stdout);
    assert.equal(destroyed.state, 'destroyed');
    assert.equal(destroyed.cleanup.resources_remaining, false);
    await assert.rejects(access(space.work_path));
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
