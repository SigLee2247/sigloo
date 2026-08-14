import { randomUUID } from 'node:crypto';
import { chmod, link, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { loadAuthProfile } from './browser/auth-profile.mjs';
import { BrowserSpace } from './browser/browser-space.mjs';
import { CdpPipe } from './browser/cdp-pipe.mjs';
import { ResourceSupervisor } from './supervisor/resource-supervisor.mjs';
import { BrowserViewer } from './viewer/read-only-viewer.mjs';

const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function validateName(name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) throw new Error('Auth Profile name is invalid');
}

function canonicalOrigin(value) {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.origin !== value) {
    throw new Error('Auth Profile origin must be a canonical HTTP(S) origin');
  }
  return parsed.origin;
}

function publicProfile(name, loaded) {
  return {
    schema_version: 1,
    name,
    origin: loaded.profile.origin,
    path: loaded.path,
    digest: loaded.digest,
    cookie_count: loaded.profile.cookies.length,
    local_storage_count: Object.keys(loaded.profile.local_storage).length,
  };
}

export class AuthProfileStore {
  constructor({ dataRoot = process.env.SIGLOO_DATA_ROOT ?? join(homedir(), '.local', 'share', 'sigloo') } = {}) {
    this.root = resolve(dataRoot, 'auth-profiles');
    this.selectionPath = join(this.root, 'selected');
  }

  async initialize() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await chmod(this.root, 0o700);
  }

  path(name) {
    validateName(name);
    return join(this.root, `${name}.json`);
  }

  async create(name, origin) {
    await this.initialize();
    return this.write(name, { schema_version: 1, origin: canonicalOrigin(origin), cookies: [], local_storage: {} }, { replace: false });
  }

  async write(name, profile, { replace = true } = {}) {
    await this.initialize();
    const path = this.path(name);
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    const bytes = Buffer.from(`${JSON.stringify(profile, null, 2)}\n`);
    if (bytes.length > 1_048_576) throw new Error('Auth Profile must not exceed 1 MiB');
    await writeFile(temporary, bytes, { mode: 0o600 });
    try {
      await loadAuthProfile(temporary);
      if (replace) await rename(temporary, path);
      else {
        try { await link(temporary, path); }
        catch (error) { if (error.code === 'EEXIST') throw new Error(`Auth Profile already exists: ${name}`); throw error; }
        await rm(temporary, { force: true });
      }
      await chmod(path, 0o600);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    return this.inspect(name);
  }

  async inspect(name) {
    await this.initialize();
    try { return publicProfile(name, await loadAuthProfile(this.path(name))); }
    catch (error) { if (error.code === 'ENOENT') throw new Error(`Auth Profile not found: ${name}`); throw error; }
  }

  async select(name) {
    const profile = await this.inspect(name);
    const temporary = `${this.selectionPath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${name}\n`, { mode: 0o600 });
    await rename(temporary, this.selectionPath);
    await chmod(this.selectionPath, 0o600);
    return profile;
  }

  async selected() {
    await this.initialize();
    let name;
    try { name = (await readFile(this.selectionPath, 'utf8')).trim(); }
    catch (error) { if (error.code === 'ENOENT') throw new Error('No Auth Profile is selected'); throw error; }
    validateName(name);
    return this.inspect(name);
  }

  async list() {
    await this.initialize();
    const names = (await readdir(this.root)).filter((name) => name.endsWith('.json')).sort();
    return Promise.all(names.map((file) => this.inspect(file.slice(0, -5))));
  }
}

export async function loginAuthProfile(name, {
  store = new AuthProfileStore(), url, timeoutMs = 300_000,
  chromePath = process.env.SIGLOO_CHROME_PATH ?? DEFAULT_CHROME, onViewerReady = () => {},
} = {}) {
  const selected = await store.select(name);
  const target = new URL(url ?? selected.origin);
  if (target.origin !== selected.origin || !['http:', 'https:'].includes(target.protocol)) throw new Error('Login URL must match the Auth Profile origin');
  const loaded = await loadAuthProfile(selected.path);
  const temporaryProfile = await mkdtemp(join(tmpdir(), 'sigloo-auth-login-'));
  const supervisor = new ResourceSupervisor();
  supervisor.register('temporary-profile', () => rm(temporaryProfile, { recursive: true, force: true }));
  let viewer;
  try {
    const cdp = await CdpPipe.launch(chromePath, [
      '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${temporaryProfile}`,
      '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', 'about:blank',
    ]);
    supervisor.register('browser-process', () => cdp.close());
    const space = await BrowserSpace.create(cdp, target.href, loaded.profile);
    supervisor.register('browser-context', () => space.dispose());
    viewer = new BrowserViewer({ captureFrame: () => space.captureScreenshot(), dispatchInput: (event) => space.dispatchInput(event), allowSave: true });
    const viewerUrl = await viewer.start();
    supervisor.register('viewer', () => viewer.close());
    await onViewerReady({ url: viewerUrl, profile: name });
    let timer;
    try {
      await Promise.race([
        viewer.waitForSave(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Auth login timed out')), timeoutMs); }),
      ]);
    } finally { clearTimeout(timer); }
    const profile = await space.captureAuthProfile();
    const saved = await store.write(name, profile);
    return { status: 'saved', profile: saved, viewer: viewer.report(), profile_digest: saved.digest };
  } finally {
    const cleanup = await supervisor.shutdown();
    if (cleanup.resources_remaining) throw new Error('Auth login cleanup left resources');
  }
}
