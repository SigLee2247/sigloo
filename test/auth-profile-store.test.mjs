import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { AuthProfileStore, loginAuthProfile } from '../src/auth-profile-store.mjs';

const execFileAsync = promisify(execFile);
const cli = new URL('../bin/sigloo.mjs', import.meta.url).pathname;

test('Auth Profiles create, select and explicitly save login state without exposing values', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sigloo-auth-profile-test-'));
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Auth login</title><script>document.cookie="session=login-cookie-secret; Path=/";localStorage.setItem("session-state","login-storage-secret")</script>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const dataRoot = join(root, 'data');
  const store = new AuthProfileStore({ dataRoot });
  try {
    const created = await store.create('account', origin);
    assert.equal(created.cookie_count, 0);
    assert.equal((await lstat(created.path)).mode & 0o077, 0);
    assert.equal((await store.list()).length, 1);
    assert.equal((await store.select('account')).path, created.path);

    const result = await loginAuthProfile('account', {
      store, url: `${origin}/login`, timeoutMs: 10_000,
      async onViewerReady({ url }) {
        assert.equal((await fetch(url)).status, 200);
        const control = url.replace('/space/', '/control/');
        assert.equal((await fetch(`${control}/save`, { method: 'POST', body: '{}' })).status, 409);
        assert.equal((await fetch(`${control}/takeover`, { method: 'POST', body: '{}' })).status, 200);
        assert.equal((await fetch(`${control}/save`, { method: 'POST', body: '{}' })).status, 200);
      },
    });
    assert.equal(result.status, 'saved');
    assert.equal(result.viewer.login_saved, true);
    const selected = await store.select('account');
    assert.equal(selected.cookie_count, 1);
    assert.equal(selected.local_storage_count, 1);
    const bytes = await readFile(selected.path, 'utf8');
    assert.match(bytes, /login-cookie-secret/);
    assert.match(bytes, /login-storage-secret/);
    assert.doesNotMatch(JSON.stringify(result), /login-cookie-secret|login-storage-secret/);

    const environment = { ...process.env, SIGLOO_DATA_ROOT: dataRoot };
    const listed = JSON.parse((await execFileAsync(process.execPath, [cli, 'auth', 'list', '--json'], { env: environment })).stdout);
    assert.equal(listed[0].name, 'account');
    const selectedPath = (await execFileAsync(process.execPath, [cli, 'auth', 'select', 'account'], { env: environment })).stdout.trim();
    assert.equal(selectedPath, selected.path);
    const scriptPath = join(root, 'selected-profile-test.mjs');
    await writeFile(scriptPath, `export default async function (page) {
      page.assert('selected-profile-cookie', await page.getCookie('session') === 'login-cookie-secret');
    }\n`);
    const browser = await execFileAsync(process.execPath, [
      cli, 'browser', 'run', '--url', `${origin}/`, '--script', scriptPath,
    ], { env: environment, cwd: root, timeout: 20_000 });
    assert.match(browser.stdout, /"status":"passed"/);
  } finally {
    server.close();
    await once(server, 'close');
    await rm(root, { recursive: true, force: true });
  }
});
