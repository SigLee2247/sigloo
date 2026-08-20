import { createHash, randomUUID } from 'node:crypto';
import { chmod, cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectEnvironment } from './doctor.mjs';
import { SpaceStore } from './space-store.mjs';
import { recoverManagedTemporaryDirectories } from './supervisor/managed-temporary.mjs';

function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export async function setupSigloo() {
  const store = new SpaceStore();
  await store.initialize();
  const environment = await inspectEnvironment();
  const recovery = await recoverManagedTemporaryDirectories();
  return {
    status: 'ready',
    data_root: store.dataRoot,
    drivers: environment.drivers,
    chrome: environment.chrome,
    recovery,
  };
}

export async function installCodexSkill({
  skillsRoot = process.env.SIGLOO_CODEX_SKILLS_DIR ?? join(homedir(), '.codex', 'skills'),
} = {}) {
  const sourceRoot = fileURLToPath(new URL('../skills', import.meta.url));
  const bundled = ['sigloo', 'sigloo-browser', 'sigloo-desktop', 'sigloo-process', 'sigloo-release'];
  const installed = [];
  const source = join(sourceRoot, 'sigloo', 'SKILL.md');
  const bytes = await readFile(source);
  const destinationDirectory = resolve(skillsRoot, 'sigloo');
  const destination = join(destinationDirectory, 'SKILL.md');
  await mkdir(destinationDirectory, { recursive: true, mode: 0o700 });
  await chmod(destinationDirectory, 0o700);
  let previous = null;
  try {
    const existing = await readFile(destination);
    if (!existing.toString('utf8').match(/^---\nname: sigloo\n/)) {
      throw new Error('Refusing to replace a non-Sigloo Skill');
    }
    previous = digest(existing);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes, { mode: 0o600 });
  await rename(temporary, destination);
  await chmod(destination, 0o600);
  installed.push({ name: 'sigloo', path: destination, digest: digest(bytes), previous_digest: previous });
  for (const name of bundled.slice(1)) {
    const sourceDirectory = join(sourceRoot, name);
    const destinationDirectory = resolve(skillsRoot, name);
    await mkdir(destinationDirectory, { recursive: true, mode: 0o700 });
    await cp(sourceDirectory, destinationDirectory, { recursive: true, force: true });
    const installedSkill = await readFile(join(destinationDirectory, 'SKILL.md'));
    await chmod(join(destinationDirectory, 'SKILL.md'), 0o600);
    installed.push({ name, path: join(destinationDirectory, 'SKILL.md'), digest: digest(installedSkill), previous_digest: null });
  }
  return {
    status: 'installed',
    agent: 'codex',
    path: destination,
    digest: digest(bytes),
    previous_digest: previous,
    skills: installed,
  };
}
