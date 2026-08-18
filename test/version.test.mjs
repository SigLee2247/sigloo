import test from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from '../src/cli.mjs';
import { SIGLOO_VERSION } from '../src/version.mjs';

test('CLI reports the release version', async () => {
  let output = '';
  const code = await runCli(['--version'], { output: { write(value) { output += value; } } });
  assert.equal(code, 0);
  assert.equal(output, `${SIGLOO_VERSION}\n`);
  assert.equal(SIGLOO_VERSION, '0.1.0');
});
