import { inspectEnvironment } from './doctor.mjs';
import { runProcessSpace } from './process-space.mjs';
import { runBrowserTestSpace } from './browser-run.mjs';
import { runBrowserSpaceSpike } from '../spikes/browser-space/run.mjs';

const HELP = `Usage:
  sigloo doctor [--json]
  sigloo run [--name NAME] [--evidence-dir PATH] -- COMMAND [ARG...]
  sigloo browser run --url URL --script PATH --auth-profile PATH [--viewer] [options]
  sigloo browser probe [--json]

Commands:
  doctor         Inspect local driver readiness
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
  return { name, evidenceDirectory, command: arguments_[index], args: arguments_.slice(index + 1) };
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
      const { report, evidencePath } = await runProcessSpace({ ...options, invocationDirectory });
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
    errorOutput.write(`sigloo: ${error.message}\n`);
    errorOutput.write(HELP);
    return 2;
  }
}
