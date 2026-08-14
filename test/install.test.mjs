import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const installer = new URL('../scripts/install-local.mjs', import.meta.url).pathname;

test('local install, update, setup, Skill install, restart and uninstall are recoverable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sigloo-install-e2e-'));
  const installRoot = join(root, 'install');
  const binDirectory = join(root, 'bin');
  const command = join(binDirectory, 'sigloo');
  const dataRoot = join(root, 'data');
  const skillsRoot = join(root, 'skills');
  const installArgs = ['install', '--install-root', installRoot, '--bin-dir', binDirectory];
  try {
    const first = JSON.parse((await execFileAsync(process.execPath, [installer, ...installArgs])).stdout);
    assert.equal(first.status, 'installed');
    assert.match(first.digest, /^sha256:[a-f0-9]{64}$/);
    assert.equal((await lstat(command)).isSymbolicLink(), true);

    const second = JSON.parse((await execFileAsync(process.execPath, [installer, ...installArgs])).stdout);
    assert.equal(second.digest, first.digest);
    assert.match((await execFileAsync(command, ['--help'])).stdout, /sigloo create NAME/);

    const setup = JSON.parse((await execFileAsync(command, ['setup', '--json'], {
      env: { ...process.env, SIGLOO_DATA_ROOT: dataRoot },
    })).stdout);
    assert.equal(setup.status, 'ready');
    assert.equal(setup.data_root, dataRoot);
    assert.equal((await lstat(dataRoot)).mode & 0o077, 0);

    const skill = JSON.parse((await execFileAsync(command, ['agent', 'install', 'codex', '--json'], {
      env: { ...process.env, SIGLOO_CODEX_SKILLS_DIR: skillsRoot },
    })).stdout);
    assert.equal(skill.status, 'installed');
    assert.match(await readFile(join(skillsRoot, 'sigloo', 'SKILL.md'), 'utf8'), /^---\nname: sigloo\n/);
    assert.equal((await lstat(join(skillsRoot, 'sigloo', 'SKILL.md'))).mode & 0o077, 0);

    const uninstall = JSON.parse((await execFileAsync(process.execPath, [
      installer, 'uninstall', '--install-root', installRoot, '--bin-dir', binDirectory,
    ])).stdout);
    assert.equal(uninstall.status, 'uninstalled');
    await assert.rejects(access(command));
    await access(first.release);

    const foreign = join(binDirectory, 'sigloo');
    await writeFile(foreign, 'foreign');
    await assert.rejects(
      execFileAsync(process.execPath, [installer, ...installArgs]),
      (error) => error.code === 2 && /non-symlink/.test(error.stderr),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
