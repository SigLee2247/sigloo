import { inspectEnvironment } from './doctor.mjs';
import { runProcessSpace } from './process-space.mjs';
import { runBrowserTestSpace } from './browser-run.mjs';
import { runBrowserSpaceSpike } from '../spikes/browser-space/run.mjs';
import { parseTtl, SpaceError, SpaceStore } from './space-store.mjs';

const HELP = `Usage:
  sigloo doctor [--json]
  sigloo create NAME [--ttl 30m] [--json]
  sigloo list [--json]
  sigloo inspect SPACE [--json]
  sigloo complete SPACE [--json]
  sigloo destroy SPACE [--json]
  sigloo run SPACE -- COMMAND [ARG...]
  sigloo run [--name NAME] [--evidence-dir PATH] -- COMMAND [ARG...]
  sigloo browser run --url URL --script PATH --auth-profile PATH [--viewer] [options]
  sigloo browser probe [--json]

Commands:
  doctor         Inspect local driver readiness
  create         Create a named persistent Space
  list           List Spaces owned by the caller
  inspect        Reconnect to a Space by name or ID
  complete       Mark a Space complete while preserving artifacts
  destroy        Remove a Space and emit cleanup state
  run            Run a command in a temporary Process Space
  browser run    Run a JavaScript test in an isolated Browser Space
  browser probe  Verify BrowserContext isolation with stock Chromium
`;

function printJson(value, output) {
  output.write(`${JSON.stringify(value, null, 2)}\n`);
}

function parseRun(arguments_) {
  let name = 'e2e';
  let evidenceDirectory = '.sigloo/evidence';
  let index = 0;
  let space = null;
  if (arguments_[0] && !arguments_[0].startsWith('-')) {
    space = arguments_[0];
    index = 1;
  }
  for (; index < arguments_.length; index += 1) {
    const token = arguments_[index];
    if (token === '--') {
      index += 1;
      break;
    }
    if (token === '--name' || token === '--evidence-dir') {
      const value = arguments_[index + 1];
      if (!value) throw new Error(`${token} requires a value`);
      if (token === '--name') name = value;
      else evidenceDirectory = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown run option: ${token}`);
  }
  return { name, space, evidenceDirectory, command: arguments_[index], args: arguments_.slice(index + 1) };
}

function parseCreate(arguments_) {
  const name = arguments_[0];
  if (!name || name.startsWith('-')) throw new SpaceError('MISSING_SPACE_NAME', 'create requires a Space name', 2);
  let ttlMs = parseTtl('30m');
  for (let index = 1; index < arguments_.length; index += 1) {
    const token = arguments_[index];
    if (token === '--json') continue;
    if (token === '--ttl') {
      const value = arguments_[index + 1];
      if (!value) throw new SpaceError('MISSING_TTL', '--ttl requires a value', 2);
      ttlMs = parseTtl(value);
      index += 1;
      continue;
    }
    throw new SpaceError('UNKNOWN_OPTION', `Unknown create option: ${token}`, 2);
  }
  return { name, ttlMs };
}

function humanSpace(record) {
  return `${record.id}  ${record.state}  ${record.name}  expires ${record.expires_at}\n`;
}

function parseSpaceIdentifier(command, arguments_) {
  const positional = arguments_.filter((token) => token !== '--json');
  if (positional.length === 0) {
    throw new SpaceError('MISSING_SPACE', `${command} requires a Space name or ID`, 2);
  }
  if (positional.length > 1 || positional[0].startsWith('-')) {
    throw new SpaceError('UNKNOWN_OPTION', `Unknown ${command} option: ${positional.slice(1)[0] ?? positional[0]}`, 2);
  }
  return positional[0];
}

function parseBrowserRun(arguments_) {
  const options = {
    name: 'browser-e2e',
    evidenceDirectory: '.sigloo/evidence',
    timeoutMs: 30_000,
    viewer: false,
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const token = arguments_[index];
    if (token === '--json') continue;
    if (token === '--viewer') {
      options.viewer = true;
      continue;
    }
    if (['--name', '--url', '--script', '--auth-profile', '--evidence-dir', '--timeout-ms', '--viewer-hold-ms'].includes(token)) {
      const value = arguments_[index + 1];
      if (!value) throw new Error(`${token} requires a value`);
      if (token === '--name') options.name = value;
      if (token === '--url') options.url = value;
      if (token === '--script') options.script = value;
      if (token === '--auth-profile') options.authProfile = value;
      if (token === '--evidence-dir') options.evidenceDirectory = value;
      if (token === '--timeout-ms') {
        options.timeoutMs = Number(value);
        if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1_000 || options.timeoutMs > 300_000) {
          throw new Error('--timeout-ms must be an integer between 1000 and 300000');
        }
      }
      if (token === '--viewer-hold-ms') {
        options.viewer = true;
        options.viewerHoldMs = Number(value);
        if (!Number.isInteger(options.viewerHoldMs) || options.viewerHoldMs < 0 || options.viewerHoldMs > 300_000) {
          throw new Error('--viewer-hold-ms must be an integer between 0 and 300000');
        }
      }
      index += 1;
      continue;
    }
    throw new Error(`Unknown browser run option: ${token}`);
  }
  if (!options.url || !options.script || !options.authProfile) {
    throw new Error('browser run requires --url, --script and --auth-profile');
  }
  return options;
}

export async function runCli(arguments_, {
  output = process.stdout,
  errorOutput = process.stderr,
  invocationDirectory = process.cwd(),
} = {}) {
  const [command, ...rest] = arguments_;
  try {
    if (!command || command === '--help' || command === '-h' || command === 'help') {
      output.write(HELP);
      return 0;
    }
    if (command === '--version' || command === '-v') {
      output.write('0.0.0\n');
      return 0;
    }
    if (command === 'doctor') {
      const report = await inspectEnvironment();
      printJson(report, output);
      return report.status === 'ready' ? 0 : 2;
    }
    if (command === 'create') {
      const options = parseCreate(rest);
      const record = await new SpaceStore().create(options.name, options.ttlMs);
      if (rest.includes('--json')) printJson(record, output);
      else output.write(humanSpace(record));
      return 0;
    }
    if (command === 'list') {
      const unknown = rest.find((token) => token !== '--json');
      if (unknown) throw new SpaceError('UNKNOWN_OPTION', `Unknown list option: ${unknown}`, 2);
      const records = await new SpaceStore().list();
      if (rest.includes('--json')) printJson(records, output);
      else records.forEach((record) => output.write(humanSpace(record)));
      return 0;
    }
    if (['inspect', 'complete', 'destroy'].includes(command)) {
      const identifier = parseSpaceIdentifier(command, rest);
      const store = new SpaceStore();
      const record = command === 'inspect' ? await store.inspect(identifier)
        : command === 'complete' ? await store.complete(identifier) : await store.destroy(identifier);
      if (rest.includes('--json')) printJson(record, output);
      else output.write(humanSpace(record));
      return 0;
    }
    if (command === 'browser' && rest[0] === 'probe') {
      const report = await runBrowserSpaceSpike();
      printJson(report, output);
      return report.cleanup.resources_remaining ? 1 : 0;
    }
    if (command === 'browser' && rest[0] === 'run') {
      const options = parseBrowserRun(rest.slice(1));
      const { report, evidencePath } = await runBrowserTestSpace({
        ...options,
        invocationDirectory,
        onViewerReady(info) {
          output.write(`SIGLOO_VIEWER ${JSON.stringify({
            space_id: info.spaceId,
            url: info.url,
            mode: info.mode,
            control_owner: info.controlOwner,
          })}\n`);
        },
      });
      output.write(`SIGLOO_RECEIPT ${JSON.stringify({
        space_id: report.space_id,
        status: report.status,
        evidence: evidencePath,
        artifacts: report.artifacts.map((artifact) => artifact.path),
        auth_profile_unchanged: report.auth_profile.unchanged,
        viewer: report.viewer,
        cleanup: report.cleanup,
      })}\n`);
      return report.status === 'passed' ? 0 : 1;
    }
    if (command === 'run') {
      const options = parseRun(rest);
      let store;
      let persistentSpace;
      if (options.space) {
        store = new SpaceStore();
        persistentSpace = await store.resolveRunnable(options.space);
        options.name = persistentSpace.name;
      }
      const { report, evidencePath } = await runProcessSpace({
        ...options, persistentSpace, invocationDirectory,
      });
      if (store) await store.recordRun(options.space, { status: report.status, evidencePath });
      output.write(`SIGLOO_RECEIPT ${JSON.stringify({
        space_id: report.space_id,
        status: report.status,
        evidence: evidencePath,
        cleanup: report.cleanup,
      })}\n`);
      return report.result.exit_code ?? 1;
    }
    throw new Error(`Unknown command: ${arguments_.join(' ')}`);
  } catch (error) {
    if (arguments_.includes('--json')) {
      printJson({ error: { code: error.code ?? 'USAGE_ERROR', message: error.message } }, errorOutput);
    } else {
      errorOutput.write(`sigloo: ${error.message}\n`);
      if (!(error instanceof SpaceError) || error.exitCode === 2) errorOutput.write(HELP);
    }
    return error.exitCode ?? 2;
  }
}
