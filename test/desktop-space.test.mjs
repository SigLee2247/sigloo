import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDesktopSpace } from '../src/desktop-space.mjs';

test('Desktop Space isolates user data and cleans it after an Electron-style launch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sigloo-desktop-test-'));
  const launcher = join(root, 'electron-stub.sh');
  const appScript = join(root, 'app.mjs');
  const app = join(root, 'app');
  await writeFile(app, 'app');
  await writeFile(appScript, `import { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.SIGLOO_DESKTOP_USER_DATA_DIR + '/marker', 'isolated');\nprocess.stdout.write(process.env.SIGLOO_SPACE_DRIVER + ':' + (process.env.SIGLOO_TEST_SECRET ? 'leaked' : 'redacted'));\n`);
  await writeFile(launcher, `#!/bin/sh\nshift\nexec ${process.execPath} "$@"\n`);
  await chmod(launcher, 0o755);
  const previousSecret = process.env.SIGLOO_TEST_SECRET;
  process.env.SIGLOO_TEST_SECRET = 'should-not-cross';
  try {
    const { report, evidencePath } = await runDesktopSpace({ name: 'desktop-test', app: './app.mjs', electronPath: launcher, invocationDirectory: root });
    assert.equal(report.status, 'passed');
    assert.equal(report.driver, 'desktop');
    assert.equal(report.desktop.renderer.page_url, null);
    assert.equal(report.cleanup.resources_remaining, false);
    assert.equal(await readFile(report.artifacts.items[0].path, 'utf8'), 'desktop:redacted');
    assert.match(await readFile(evidencePath, 'utf8'), /user_data_removed/);
  } finally {
    if (previousSecret === undefined) delete process.env.SIGLOO_TEST_SECRET;
    else process.env.SIGLOO_TEST_SECRET = previousSecret;
    await rm(root, { recursive: true, force: true });
  }
});
