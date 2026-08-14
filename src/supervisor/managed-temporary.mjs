import { chmod, lstat, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MARKER = '.sigloo-owner.json';

export async function createManagedTemporaryDirectory(prefix, { directory = tmpdir() } = {}) {
  if (!/^sigloo-[a-z-]+-$/.test(prefix)) throw new Error('Managed temporary prefix is invalid');
  const path = await mkdtemp(join(directory, prefix));
  await chmod(path, 0o700);
  await writeFile(join(path, MARKER), `${JSON.stringify({
    schema_version: 1,
    pid: process.pid,
    uid: process.getuid?.() ?? null,
    created_at: new Date().toISOString(),
  })}\n`, { mode: 0o600 });
  return path;
}

function processExists(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

export async function recoverManagedTemporaryDirectories({
  directory = tmpdir(), prefixes = ['sigloo-browser-run-', 'sigloo-auth-login-'],
} = {}) {
  const receipt = { scanned: 0, recovered: 0, active: 0, rejected: 0, resources_remaining: false };
  let names = [];
  try { names = await readdir(directory); } catch { return receipt; }
  for (const name of names.filter((item) => prefixes.some((prefix) => item.startsWith(prefix)))) {
    receipt.scanned += 1;
    const path = join(directory, name);
    try {
      const metadata = await lstat(path);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('invalid directory');
      const marker = JSON.parse(await readFile(join(path, MARKER), 'utf8'));
      if (marker.schema_version !== 1 || marker.uid !== (process.getuid?.() ?? null) || !Number.isInteger(marker.pid) || marker.pid < 1) {
        throw new Error('invalid marker');
      }
      if (processExists(marker.pid)) { receipt.active += 1; continue; }
      await rm(path, { recursive: true, force: true });
      receipt.recovered += 1;
    } catch {
      receipt.rejected += 1;
    }
  }
  receipt.resources_remaining = receipt.rejected > 0;
  return receipt;
}
