import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectEnvironment } from './doctor.mjs';
import { SpaceStore } from './space-store.mjs';

function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export async function setupSigloo() {
  const store = new SpaceStore();
  await store.initialize();
  const environment = await inspectEnvironment();
  return {
    status: 'ready',
    data_root: store.dataRoot,
    drivers: environment.drivers,
    chrome: environment.chrome,
  };
}

export async function installCodexSkill({
  skillsRoot = process.env.SIGLOO_CODEX_SKILLS_DIR ?? join(homedir(), '.codex', 'skills'),
} = {}) {
  const source = fileURLToPath(new URL('../skills/sigloo/SKILL.md', import.meta.url));
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
  return {
    status: 'installed',
    agent: 'codex',
    path: destination,
    digest: digest(bytes),
    previous_digest: previous,
  };
}
