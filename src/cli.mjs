import { inspectEnvironment } from './doctor.mjs';
import { runProcessSpace } from './process-space.mjs';
import { runBrowserSpaceSpike } from '../spikes/browser-space/run.mjs';

const HELP = `Usage:
  sigloo doctor [--json]
  sigloo run [--name NAME] [--evidence-dir PATH] -- COMMAND [ARG...]
  sigloo browser probe [--json]

Commands:
  doctor         Inspect local driver readiness
  run            Run a command in a temporary Process Space
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
