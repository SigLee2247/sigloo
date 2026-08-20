import { inspectEnvironment } from './doctor.mjs';
import { runProcessSpace } from './process-space.mjs';
import { runBrowserTestSpace } from './browser-run.mjs';
import { runBrowserSpaceSpike } from '../spikes/browser-space/run.mjs';
import { parseTtl, SpaceError, SpaceStore } from './space-store.mjs';
import { installCodexSkill, setupSigloo } from './setup.mjs';
import { AuthProfileStore, loginAuthProfile } from './auth-profile-store.mjs';
import { SIGLOO_VERSION } from './version.mjs';
import { runDesktopSpace } from './desktop-space.mjs';
import { runPlaywrightTest } from './playwright-run.mjs';

const HELP = `Usage:
  sigloo doctor [--json]
  sigloo setup [--json]
  sigloo agent install codex [--json]
  sigloo auth create NAME --origin ORIGIN [--json]
  sigloo auth list [--json]
  sigloo auth inspect NAME [--json]
  sigloo auth select NAME [--json]
  sigloo auth login NAME [--url URL] [--timeout-ms N] [--json]
  sigloo create NAME [--ttl 30m] [--json]
  sigloo list [--json]
  sigloo inspect SPACE [--json]
  sigloo report SPACE [--json]
  sigloo complete SPACE [--json]
  sigloo destroy SPACE [--json]
  sigloo run SPACE -- COMMAND [ARG...]
  sigloo run [--name NAME] [--evidence-dir PATH] -- COMMAND [ARG...]
  sigloo playwright run [--name NAME] [--evidence-dir PATH] -- [PLAYWRIGHT ARG...]
  sigloo browser run --url URL --script PATH [--auth-profile PATH] [--viewer] [options]
  sigloo browser probe [--json]
  sigloo desktop run --app PATH --electron-path PATH [--script PATH] [--timeout-ms N] [-- ARG...]

Commands:
  doctor         Inspect local driver readiness
  setup          Initialize the owner-only local data root
  agent install  Install a companion Skill for an Agent host
  auth            Create, select and explicitly refresh dedicated Auth Profiles
  create         Create a named persistent Space
  list           List Spaces owned by the caller
  inspect        Reconnect to a Space by name or ID
  report         Read the latest bounded run report
  complete       Mark a Space complete while preserving artifacts
  destroy        Remove a Space and emit cleanup state
  run            Run a command in a temporary Process Space
  playwright run Run native Playwright CLI in a Process Space
  browser run    Run a JavaScript test in an isolated Browser Space
  browser probe  Verify BrowserContext isolation with stock Chromium
  desktop run    Run an Electron app with isolated user data and bounded evidence
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

function humanReport(report) {
  const cleanup = report.cleanup.resources_remaining ? 'resources remain' : 'clean';
  return `${report.space_id}  ${report.status}  ${report.artifacts.items.length} artifacts  ${cleanup}\n`;
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
  if (!options.url || !options.script) {
    throw new Error('browser run requires --url and --script');
  }
  return options;
}

function parseDesktopRun(arguments_) {
  const options = { args: [], timeoutMs: 30_000 };
  let separator = arguments_.indexOf('--');
  if (separator < 0) separator = arguments_.length;
  options.args = arguments_.slice(separator + 1);
  for (let index = 0; index < separator; index += 1) {
    const token = arguments_[index];
    if (token === '--json') continue;
    if (['--name', '--app', '--electron-path', '--script', '--evidence-dir', '--timeout-ms'].includes(token)) {
      const value = arguments_[index + 1];
      if (!value) throw new Error(`${token} requires a value`);
      if (token === '--name') options.name = value;
      if (token === '--app') options.app = value;
      if (token === '--electron-path') options.electronPath = value;
      if (token === '--script') options.script = value;
      if (token === '--evidence-dir') options.evidenceDirectory = value;
      if (token === '--timeout-ms') options.timeoutMs = Number(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown desktop run option: ${token}`);
  }
  if (!options.app) throw new Error('desktop run requires --app');
  if (!options.electronPath) throw new Error('desktop run requires --electron-path');
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1_000 || options.timeoutMs > 300_000) throw new Error('--timeout-ms must be an integer between 1000 and 300000');
  return options;
}

function parsePlaywrightRun(arguments_) {
  let name = 'playwright-e2e';
  let evidenceDirectory = '.sigloo/evidence';
  const separator = arguments_.indexOf('--');
  const options = separator < 0 ? arguments_ : arguments_.slice(0, separator);
  for (let index = 0; index < options.length; index += 1) {
    const token = options[index];
    if (token === '--json') continue;
    if (token === '--name' || token === '--evidence-dir') {
      const value = options[index + 1];
      if (!value) throw new Error(`${token} requires a value`);
      if (token === '--name') name = value;
      else evidenceDirectory = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown playwright run option: ${token}`);
  }
  const command = separator < 0 ? [] : arguments_.slice(separator + 1);
  return { name, evidenceDirectory, args: command.length ? command : ['npx', 'playwright', 'test'] };
}

function parseAuth(command, arguments_) {
  const options = { json: arguments_.includes('--json') };
  const positional = [];
  for (let index = 0; index < arguments_.length; index += 1) {
    const token = arguments_[index];
    if (token === '--json') continue;
    if (['--origin', '--url', '--timeout-ms'].includes(token)) {
      const value = arguments_[index + 1];
      if (!value) throw new Error(`${token} requires a value`);
      if (token === '--origin') options.origin = value;
      if (token === '--url') options.url = value;
      if (token === '--timeout-ms') {
        options.timeoutMs = Number(value);
        if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1_000 || options.timeoutMs > 900_000) {
          throw new Error('--timeout-ms must be an integer between 1000 and 900000');
        }
      }
      index += 1;
      continue;
    }
    if (token.startsWith('-')) throw new Error(`Unknown auth option: ${token}`);
    positional.push(token);
  }
  if (command === 'list') {
    if (positional.length > 0 || options.origin || options.url || options.timeoutMs) throw new Error('auth list does not accept arguments');
    return options;
  }
  if (positional.length !== 1) throw new Error(`auth ${command} requires one profile name`);
  options.name = positional[0];
  if (command === 'create' && !options.origin) throw new Error('auth create requires --origin');
  if (command !== 'create' && options.origin) throw new Error(`auth ${command} does not accept --origin`);
  if (command !== 'login' && (options.url || options.timeoutMs)) throw new Error(`auth ${command} does not accept login options`);
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
      output.write(`${SIGLOO_VERSION}\n`);
      return 0;
    }
    if (command === 'doctor') {
      const report = await inspectEnvironment();
      printJson(report, output);
      return report.status === 'ready' ? 0 : 2;
    }
    if (command === 'setup') {
      const unknown = rest.find((token) => token !== '--json');
      if (unknown) throw new Error(`Unknown setup option: ${unknown}`);
      const report = await setupSigloo();
      if (rest.includes('--json')) printJson(report, output);
      else output.write(`Sigloo ready at ${report.data_root}\n`);
      return 0;
    }
    if (command === 'agent' && rest[0] === 'install') {
      if (rest[1] !== 'codex') throw new Error('agent install currently supports codex');
      const unknown = rest.slice(2).find((token) => token !== '--json');
      if (unknown) throw new Error(`Unknown agent install option: ${unknown}`);
      const report = await installCodexSkill();
      if (rest.includes('--json')) printJson(report, output);
      else output.write(`Installed $sigloo for Codex at ${report.path}\n`);
      return 0;
    }
    if (command === 'auth') {
      const authCommand = rest[0];
      if (!['create', 'list', 'inspect', 'select', 'login'].includes(authCommand)) throw new Error('auth requires create, list, inspect, select or login');
      const options = parseAuth(authCommand, rest.slice(1));
      const store = new AuthProfileStore();
      let result;
      if (authCommand === 'create') result = await store.create(options.name, options.origin);
      if (authCommand === 'list') result = await store.list();
      if (authCommand === 'inspect') result = await store.inspect(options.name);
      if (authCommand === 'select') result = await store.select(options.name);
      if (authCommand === 'login') {
        result = await loginAuthProfile(options.name, {
          store, url: options.url, timeoutMs: options.timeoutMs,
          onViewerReady(info) { output.write(`SIGLOO_VIEWER ${JSON.stringify({ profile: info.profile, url: info.url, mode: 'auth-login' })}\n`); },
        });
      }
      if (options.json) printJson(result, output);
      else if (authCommand === 'select') output.write(`${result.path}\n`);
      else if (authCommand === 'list') result.forEach((profile) => output.write(`${profile.name}  ${profile.origin}\n`));
      else output.write(`${authCommand === 'login' ? result.profile.name : result.name}  ${authCommand === 'login' ? result.profile.origin : result.origin}\n`);
      return 0;
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
    if (['inspect', 'report', 'complete', 'destroy'].includes(command)) {
      const identifier = parseSpaceIdentifier(command, rest);
      const store = new SpaceStore();
      const record = command === 'inspect' ? await store.inspect(identifier)
        : command === 'report' ? await store.report(identifier)
          : command === 'complete' ? await store.complete(identifier) : await store.destroy(identifier);
      if (rest.includes('--json')) printJson(record, output);
      else if (command === 'report') output.write(humanReport(record));
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
      if (!options.authProfile) options.authProfile = (await new AuthProfileStore().selected()).path;
      const { report, evidencePath, markdownPath } = await runBrowserTestSpace({
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
        report: markdownPath,
        artifacts: report.artifacts.map((artifact) => artifact.path),
        auth_profile_unchanged: report.auth_profile.unchanged,
        viewer: report.viewer,
        cleanup: report.cleanup,
      })}\n`);
      return report.status === 'passed' ? 0 : 1;
    }
    if (command === 'desktop' && rest[0] === 'run') {
      const options = parseDesktopRun(rest.slice(1));
      const { report, evidencePath, markdownPath } = await runDesktopSpace({ ...options, invocationDirectory });
      output.write(`SIGLOO_RECEIPT ${JSON.stringify({ space_id: report.space_id, status: report.status, evidence: evidencePath, report: markdownPath, artifacts: report.artifacts.items.map((artifact) => artifact.path), cleanup: report.cleanup })}\n`);
      return report.status === 'passed' ? 0 : 1;
    }
    if (command === 'playwright' && rest[0] === 'run') {
      const options = parsePlaywrightRun(rest.slice(1));
      const { report, evidencePath, markdownPath } = await runPlaywrightTest({ ...options, invocationDirectory });
      output.write(`SIGLOO_RECEIPT ${JSON.stringify({ space_id: report.space_id, status: report.status, evidence: evidencePath, report: markdownPath, artifacts: report.artifacts.items.map((artifact) => artifact.path), cleanup: report.cleanup })}\n`);
      return report.result.exit_code ?? 1;
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
      const { report, evidencePath, markdownPath } = await runProcessSpace({
        ...options, persistentSpace, invocationDirectory,
      });
      if (store) await store.recordRun(options.space, { status: report.status, evidencePath });
      output.write(`SIGLOO_RECEIPT ${JSON.stringify({
        space_id: report.space_id,
        status: report.status,
        evidence: evidencePath,
        report: markdownPath,
        artifacts: report.artifacts.items.map((artifact) => artifact.path),
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
