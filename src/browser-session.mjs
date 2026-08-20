import { randomInt, randomUUID } from 'node:crypto';
import { access, chmod, cp, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const rootFor = () => resolve(process.env.SIGLOO_DATA_ROOT ?? join(homedir(), '.local', 'share', 'sigloo'), 'browser-sessions');
function validateName(name) { if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) throw new Error('Browser Session name is invalid'); }
function pathFor(name) { validateName(name); return join(rootFor(), `${name}.json`); }
async function waitReady(port, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const response = await fetch(`http://127.0.0.1:${port}/json/version`); if (response.ok) return await response.json(); } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error('Browser Session CDP endpoint did not become ready');
}
function publicSession(record) { return { ...record, profile_dir: record.profile_dir, cdp_url: `http://127.0.0.1:${record.port}` }; }

export class BrowserSessionStore {
  async initialize() { await mkdir(rootFor(), { recursive: true, mode: 0o700 }); await chmod(rootFor(), 0o700); }
  async create(name, { ttlMs = 30 * 60_000, chromePath = process.env.SIGLOO_CHROME_PATH ?? DEFAULT_CHROME } = {}) {
    await this.initialize(); const metadataPath = pathFor(name); const profileDir = join(rootFor(), `${name}-${randomUUID()}`);
    try { await access(metadataPath); throw new Error(`Browser Session already exists: ${name}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await mkdir(profileDir, { recursive: true, mode: 0o700 });
    const port = randomInt(40_000, 49_000);
    const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check', '--disable-sync', 'about:blank'], { detached: true, stdio: 'ignore' });
    child.unref();
    const now = new Date(); const record = { schema_version: 1, name, pid: child.pid, port, profile_dir: profileDir, created_at: now.toISOString(), expires_at: new Date(now.getTime() + ttlMs).toISOString(), state: 'ready' };
    try { await waitReady(port); await writeFile(metadataPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 }); } catch (error) { try { process.kill(child.pid, 'SIGTERM'); } catch {} await rm(profileDir, { recursive: true, force: true }); throw error; }
    return publicSession(record);
  }
  async import(name, sourceDir, { approved = false, ttlMs = 30 * 60_000, chromePath = process.env.SIGLOO_CHROME_PATH ?? DEFAULT_CHROME } = {}) {
    if (!approved) throw new Error('Browser profile import requires explicit --approve');
    const source = resolve(sourceDir); const sourceMeta = await lstat(source);
    if (!sourceMeta.isDirectory() || sourceMeta.isSymbolicLink()) throw new Error('Imported browser profile must be a regular directory');
    await this.initialize(); const metadataPath = pathFor(name); const profileDir = join(rootFor(), `${name}-import-${randomUUID()}`);
    try { await access(metadataPath); throw new Error(`Browser Session already exists: ${name}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await cp(source, profileDir, { recursive: true, force: false, errorOnExist: true });
    const port = randomInt(40_000, 49_000); const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check', '--disable-sync', 'about:blank'], { detached: true, stdio: 'ignore' });
    child.unref(); const now = new Date(); const record = { schema_version: 1, name, pid: child.pid, port, profile_dir: profileDir, imported: true, source_digest: `directory:${sourceMeta.ino ?? 'unknown'}:${sourceMeta.mtimeMs}`, created_at: now.toISOString(), expires_at: new Date(now.getTime() + ttlMs).toISOString(), state: 'ready' };
    try { await waitReady(port); await writeFile(metadataPath, `${JSON.stringify(record, null, 2)}\n`, { mode: '0600' }); } catch (error) { try { process.kill(child.pid, 'SIGTERM'); } catch {} await rm(profileDir, { recursive: true, force: true }); throw error; }
    return publicSession(record);
  }
  async inspect(name) { const record = JSON.parse(await readFile(pathFor(name), 'utf8')); return publicSession(record); }
  async list() {
    await this.initialize();
    const files = (await readdir(rootFor())).filter((file) => file.endsWith('.json'));
    return Promise.all(files.map(async (file) => {
      const record = JSON.parse(await readFile(join(rootFor(), file), 'utf8'));
      return publicSession(record);
    }));
  }
  async destroy(name) {
    const metadataPath = pathFor(name); const record = JSON.parse(await readFile(metadataPath, 'utf8'));
    try { process.kill(record.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) { try { process.kill(record.pid, 0); } catch { break; } await new Promise((resolveWait) => setTimeout(resolveWait, 100)); }
    try { process.kill(record.pid, 0); process.kill(record.pid, 'SIGKILL'); } catch {}
    await rm(record.profile_dir, { recursive: true, force: true }); await rm(metadataPath, { force: true });
    return { name, destroyed: true, resources_remaining: false };
  }
}
