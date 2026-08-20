import { runProcessSpace } from './process-space.mjs';

// Native adapter: keeps Playwright's CLI and arguments untouched while giving
// it the same bounded Process Space/evidence contract as any other command.
export async function runPlaywrightTest({
  name = 'playwright-e2e',
  args = ['playwright', 'test'],
  invocationDirectory = process.cwd(),
  evidenceDirectory = '.sigloo/evidence',
  persistentSpace = null,
} = {}) {
  if (!Array.isArray(args) || args.length === 0) throw new Error('Playwright command is required');
  const [command, ...commandArgs] = args;
  return runProcessSpace({ name, command, args: commandArgs, invocationDirectory, evidenceDirectory, persistentSpace });
}
