import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDesktopSpace } from '../src/desktop-space.mjs';

test('Desktop Space isolates user data and cleans it after an Electron-style launch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sigloo-desktop-test-'));
  const launcher = join(root, 'electron-stub.mjs');
  const app = join(root, 'app');
  await writeFile(app, 'app');
  await writeFile(launcher, `import { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.SIGLOO_DESKTOP_USER_DATA_DIR + '/marker', 'isolated');\nprocess.stdout.write(process.env.SIGLOO_SPACE_DRIVER);\n`);
  await chmod(launcher, 0o755);
  try {
    const { report, evidencePath } = await runDesktopSpace({ name: 'desktop-test', app: './electron-stub.mjs', electronPath: process.execPath, invocationDirectory: root });
    assert.equal(report.status, 'passed');
    assert.equal(report.driver, 'desktop');
    assert.equal(report.cleanup.resources_remaining, false);
    assert.equal(await readFile(report.artifacts.items[0].path, 'utf8'), 'desktop');
    assert.match(await readFile(evidencePath, 'utf8'), /user_data_removed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
