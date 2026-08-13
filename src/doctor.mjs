import { access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export async function inspectEnvironment({
  chromePath = process.env.SIGLOO_CHROME_PATH ?? DEFAULT_CHROME,
} = {}) {
  let chromeAvailable = false;
  let chromeVersion = null;
  try {
    await access(chromePath);
    chromeAvailable = true;
    const { stdout } = await execFileAsync(chromePath, ['--version'], { timeout: 5_000 });
    chromeVersion = stdout.trim();
  } catch {
    // The report below is the canonical availability signal.
  }

  return {
    status: chromeAvailable ? 'ready' : 'degraded',
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    chrome: { path: chromePath, available: chromeAvailable, version: chromeVersion },
    drivers: {
      process: 'prototype',
      browser: chromeAvailable ? 'experimental' : 'unavailable',
      desktop: 'not-implemented',
    },
  };
}
