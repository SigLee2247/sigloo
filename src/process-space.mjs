import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, lstat, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { writeRunReports } from './report-renderer.mjs';

function digest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function spaceId(name) {
  const time = new Date().toISOString().replaceAll(/[-:.TZ]/g, '');
  return `${name}-${time}-${randomUUID().slice(0, 8)}`;
}

function childEnvironment(id, directory, artifactDirectories) {
  const mode = process.env.SIGLOO_PROCESS_ENV_MODE ?? 'inherit';
  let environment = { ...process.env };
  if (mode === 'allowlist') {
    const allowed = new Set((process.env.SIGLOO_PROCESS_ENV_ALLOWLIST ?? '').split(',').map((key) => key.trim()).filter(Boolean));
    environment = Object.fromEntries(Object.entries(environment).filter(([key]) => allowed.has(key) || key.startsWith('SIGLOO_')));
  } else if (mode === 'redact') {
    environment = Object.fromEntries(Object.entries(environment).filter(([key]) => !/(TOKEN|PASSWORD|SECRET|PRIVATE_KEY|API_KEY|AUTHORIZATION)/i.test(key)));
  } else if (!['inherit', 'allowlist', 'redact'].includes(mode)) {
    throw new Error('SIGLOO_PROCESS_ENV_MODE must be inherit, redact or allowlist');
  }
  return {
    ...environment,
    SIGLOO_SPACE_ID: id,
    SIGLOO_SPACE_DIR: directory,
    SIGLOO_SPACE_DRIVER: 'process',
    SIGLOO_ARTIFACT_DIR: artifactDirectories.root,
    SIGLOO_LOG_DIR: artifactDirectories.logs,
    SIGLOO_TRACE_DIR: artifactDirectories.trace,
    SIGLOO_REPORT_DIR: artifactDirectories.report,
    SIGLOO_SCREENSHOT_DIR: artifactDirectories.screenshots,
  };
}

async function waitForChild(command, args, options, { stdoutPath, stderrPath, mirrorOutput }) {
  const result = await new Promise((resolveExecution) => {
    const child = spawn(command, args, options);
    const streams = [
      [child.stdout, stdoutPath, mirrorOutput ? process.stdout : null],
      [child.stderr, stderrPath, mirrorOutput ? process.stderr : null],
    ].map(([source, path, mirror]) => {
      const destination = createWriteStream(path, { flags: 'w', mode: 0o600 });
      source.pipe(destination);
      if (mirror) source.on('data', (chunk) => mirror.write(chunk));
      return once(destination, 'finish');
    });
    child.once('error', (error) => resolveExecution({ exitCode: null, signal: null, error, streams }));
    child.once('exit', (exitCode, signal) => resolveExecution({ exitCode, signal, error: null, streams }));
  });
  await Promise.all(result.streams);
  return { exitCode: result.exitCode, signal: result.signal, error: result.error };
}

async function collectArtifacts(root, limit = 1_000) {
  const items = [];
  async function visit(directory) {
    for (const name of (await readdir(directory)).sort()) {
      if (items.length >= limit) return;
      const path = join(directory, name);
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) continue;
      if (metadata.isDirectory()) await visit(path);
      else if (metadata.isFile()) {
        const relativePath = relative(root, path);
        const firstSegment = relativePath.split('/')[0];
        items.push({
          kind: ['logs', 'trace', 'report', 'screenshots'].includes(firstSegment) ? firstSegment : 'other',
          path,
          bytes: metadata.size,
        });
      }
    }
  }
  await visit(root);
  return { root, items, truncated: items.length >= limit };
}

export async function runProcessSpace({
  name = 'e2e',
  command,
  args = [],
  invocationDirectory = process.cwd(),
  evidenceDirectory = '.sigloo/evidence',
  stdio = 'inherit',
  persistentSpace = null,
} = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
    throw new Error('Space name must be 1-64 letters, numbers, dots, underscores or hyphens');
  }
  if (!command) throw new Error('A command is required after --');

  const id = persistentSpace?.id ?? spaceId(name);
  const startedAt = new Date().toISOString();
  const requestedDirectory = persistentSpace?.directories.work ?? await mkdtemp(join(tmpdir(), 'sigloo-process-space-'));
  // macOS may expose /var through the /private/var symlink. Canonicalizing keeps
  // cwd and SIGLOO_SPACE_DIR identical for child processes and reconnects.
  const directory = await realpath(requestedDirectory);
  const commandDirectory = await realpath(invocationDirectory);
  const evidenceRoot = persistentSpace?.directories.evidence ?? resolve(invocationDirectory, evidenceDirectory);
  const artifactRoot = persistentSpace?.directories.artifacts ?? join(evidenceRoot, `${id}-artifacts`);
  const artifactDirectories = {
    root: artifactRoot,
    logs: join(artifactRoot, 'logs'),
    trace: join(artifactRoot, 'trace'),
    report: join(artifactRoot, 'report'),
    screenshots: join(artifactRoot, 'screenshots'),
  };
  await Promise.all(Object.values(artifactDirectories).map((path) => mkdir(path, { recursive: true, mode: 0o700 })));
  const stdoutPath = join(artifactDirectories.logs, 'stdout.log');
  const stderrPath = join(artifactDirectories.logs, 'stderr.log');
  const evidencePath = join(evidenceRoot, `${id}.json`);
  let execution = { exitCode: null, signal: null, error: null };
  let directoryRemoved = false;

  try {
    execution = await waitForChild(command, args, {
      cwd: commandDirectory,
      env: childEnvironment(id, directory, artifactDirectories),
      stdio: stdio === 'inherit' ? ['inherit', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
    }, { stdoutPath, stderrPath, mirrorOutput: stdio === 'inherit' });
  } finally {
    if (!persistentSpace) {
      await rm(directory, { recursive: true, force: true });
      try {
        await access(directory);
      } catch {
        directoryRemoved = true;
      }
    }
  }

  const succeeded = execution.exitCode === 0 && execution.error === null;
  const artifactInventory = await collectArtifacts(artifactRoot);
  const finishedAt = new Date().toISOString();
  const report = {
    schema_version: 1,
    space_id: id,
    name,
    driver: 'process',
    isolation_level: 'process-environment-and-space-artifacts',
    status: succeeded ? 'passed' : 'failed',
    started_at: startedAt,
    finished_at: finishedAt,
    test: {
      title: `${name} Process Space 실행 검증`,
      purpose: '기존 명령을 프로젝트 작업 디렉터리에서 실행하고, 환경 전달·로그 수집·artifact inventory·임시 공간 정리를 확인한다.',
      preconditions: ['Sigloo data root가 초기화되어 있다.', '실행 명령이 호출 디렉터리에서 유효하다.'],
      steps: ['Process Space 생성', '기존 명령 실행', 'stdout/stderr 및 artifact 수집', '임시 공간 cleanup invariant 확인'],
      success_criteria: ['명령 exit code가 0이다.', 'resources_remaining이 false이다.'],
    },
    command: {
      executable: basename(command),
      arguments_digest: digest(args),
    },
    process_policy: { environment: process.env.SIGLOO_PROCESS_ENV_MODE ?? 'inherit', filesystem: 'project-cwd-compatible', network: 'inherited' },
    result: {
      exit_code: execution.exitCode,
      signal: execution.signal,
      spawn_error: execution.error?.code ?? null,
    },
    failure: succeeded ? null : {
      step: 'command',
      category: execution.error ? 'driver' : 'test',
      exit_code: execution.exitCode,
      spawn_error: execution.error?.code ?? null,
    },
    timeline: [
      { kind: 'observation', event: 'command.started', at: startedAt },
      { kind: 'observation', event: 'command.finished', at: finishedAt, status: succeeded ? 'passed' : 'failed' },
    ],
    artifacts: artifactInventory,
    cleanup: {
      temporary_directory_removed: persistentSpace ? null : directoryRemoved,
      space_preserved: Boolean(persistentSpace),
      resources_remaining: persistentSpace ? false : !directoryRemoved,
    },
  };
  const reportPaths = await writeRunReports(report, evidenceRoot, evidencePath);
  return { report, ...reportPaths };
}
