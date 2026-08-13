import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

function digest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function spaceId(name) {
  const time = new Date().toISOString().replaceAll(/[-:.TZ]/g, '');
  return `${name}-${time}-${randomUUID().slice(0, 8)}`;
}

function waitForChild(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, options);
    child.once('error', (error) => resolve({ exitCode: null, signal: null, error }));
    child.once('exit', (exitCode, signal) => resolve({ exitCode, signal, error: null }));
  });
}

export async function runProcessSpace({
  name = 'e2e',
  command,
  args = [],
  invocationDirectory = process.cwd(),
  evidenceDirectory = '.sigloo/evidence',
  stdio = 'inherit',
} = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
    throw new Error('Space name must be 1-64 letters, numbers, dots, underscores or hyphens');
  }
  if (!command) throw new Error('A command is required after --');

  const id = spaceId(name);
  const startedAt = new Date().toISOString();
  const directory = await mkdtemp(join(tmpdir(), 'sigloo-process-space-'));
  const evidenceRoot = resolve(invocationDirectory, evidenceDirectory);
  const evidencePath = join(evidenceRoot, `${id}.json`);
  let execution = { exitCode: null, signal: null, error: null };
  let directoryRemoved = false;

  try {
    execution = await waitForChild(command, args, {
      cwd: directory,
      env: {
        ...process.env,
        SIGLOO_SPACE_ID: id,
        SIGLOO_SPACE_DIR: directory,
        SIGLOO_SPACE_DRIVER: 'process',
      },
      stdio,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
    try {
      await access(directory);
    } catch {
      directoryRemoved = true;
    }
  }

  const succeeded = execution.exitCode === 0 && execution.error === null;
  const report = {
    schema_version: 1,
    space_id: id,
    name,
    driver: 'process',
    isolation_level: 'temporary-working-directory',
    status: succeeded ? 'passed' : 'failed',
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    command: {
      executable: basename(command),
      arguments_digest: digest(args),
    },
    result: {
      exit_code: execution.exitCode,
      signal: execution.signal,
      spawn_error: execution.error?.code ?? null,
    },
    cleanup: {
      temporary_directory_removed: directoryRemoved,
      resources_remaining: !directoryRemoved,
    },
  };
  await mkdir(evidenceRoot, { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });

  return { report, evidencePath };
}
