import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { promisify } from 'node:util';
import test from 'node:test';
import { runBrowserTestSpace } from '../src/browser-run.mjs';

const execFileAsync = promisify(execFile);
const cli = new URL('../bin/sigloo.mjs', import.meta.url).pathname;

test('browser run derives Auth Profile state and leaves the source unchanged', async () => {
  const invocationDirectory = await mkdtemp(join(tmpdir(), 'sigloo-browser-run-test-'));
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Sigloo browser run</title><main id="result">ready</main>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const profilePath = join(invocationDirectory, 'auth-profile.json');
  const scriptPath = join(invocationDirectory, 'browser-test.mjs');
  const profileBytes = `${JSON.stringify({
    schema_version: 1,
    origin,
    cookies: [{ name: 'sigloo_session', value: 'profile-cookie-secret' }],
    local_storage: { sigloo_auth: 'profile-storage-secret' },
  }, null, 2)}\n`;
  await writeFile(profilePath, profileBytes, { mode: 0o600 });
  await chmod(profilePath, 0o600);
  await writeFile(scriptPath, `export default async function (page) {
    page.assert('cookie-derived', await page.getCookie('sigloo_session') === 'profile-cookie-secret');
    page.assert('storage-derived', await page.getLocalStorage('sigloo_auth') === 'profile-storage-secret');
    page.assert('page-loaded', await page.evaluate("document.querySelector('#result').textContent") === 'ready');
    await page.setCookie('sigloo_session', 'space-only-cookie');
    await page.setLocalStorage('sigloo_auth', 'space-only-storage');
    await page.screenshot('final');
  }\n`);

  try {
    const { report, evidencePath } = await runBrowserTestSpace({
      name: 'auth-e2e',
      url: `${origin}/account`,
      script: scriptPath,
      authProfile: profilePath,
      invocationDirectory,
    });
    assert.equal(report.status, 'passed');
    assert.deepEqual(report.test.checks, [
      { name: 'cookie-derived', passed: true },
      { name: 'storage-derived', passed: true },
      { name: 'page-loaded', passed: true },
    ]);
    assert.equal(report.auth_profile.unchanged, true);
    assert.equal(report.artifacts.length, 1);
    const screenshot = await readFile(report.artifacts[0].path);
    assert.deepEqual([...screenshot.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(report.cleanup.resources_remaining, false);
    assert.equal(await readFile(profilePath, 'utf8'), profileBytes);
    const evidence = await readFile(evidencePath, 'utf8');
    assert.doesNotMatch(evidence, /profile-cookie-secret|profile-storage-secret|space-only-cookie|space-only-storage/);
  } finally {
    server.close();
    await once(server, 'close');
    await rm(invocationDirectory, { recursive: true, force: true });
  }
});

test('browser run CLI emits a bounded receipt', async () => {
  const invocationDirectory = await mkdtemp(join(tmpdir(), 'sigloo-browser-cli-test-'));
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Sigloo CLI E2E</title>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const profilePath = join(invocationDirectory, 'auth-profile.json');
  const scriptPath = join(invocationDirectory, 'browser-test.mjs');
  await writeFile(profilePath, `${JSON.stringify({
    schema_version: 1,
    origin,
    cookies: [],
    local_storage: { ready: 'yes' },
  })}\n`, { mode: 0o600 });
  await chmod(profilePath, 0o600);
  await writeFile(scriptPath, `export default async function (page) {
    page.assert('cli-state-derived', await page.getLocalStorage('ready') === 'yes');
  }\n`);

  try {
    const { stdout } = await execFileAsync(process.execPath, [
      cli, 'browser', 'run', '--name', 'cli-browser-e2e', '--url', `${origin}/`,
      '--script', scriptPath, '--auth-profile', profilePath,
    ], { cwd: invocationDirectory, timeout: 20_000 });
    const receiptLine = stdout.split('\n').find((line) => line.startsWith('SIGLOO_RECEIPT '));
    assert.ok(receiptLine);
    const receipt = JSON.parse(receiptLine.slice('SIGLOO_RECEIPT '.length));
    assert.equal(receipt.status, 'passed');
    assert.equal(receipt.auth_profile_unchanged, true);
    assert.equal(receipt.cleanup.resources_remaining, false);
    assert.equal(receipt.artifacts.length, 0);
  } finally {
    server.close();
    await once(server, 'close');
    await rm(invocationDirectory, { recursive: true, force: true });
  }
});

test('browser run rejects an Auth Profile readable by other users', async () => {
  const invocationDirectory = await mkdtemp(join(tmpdir(), 'sigloo-browser-profile-mode-test-'));
  const profilePath = join(invocationDirectory, 'auth-profile.json');
  const scriptPath = join(invocationDirectory, 'browser-test.mjs');
  await writeFile(profilePath, JSON.stringify({
    schema_version: 1,
    origin: 'https://example.test',
    cookies: [],
    local_storage: {},
  }), { mode: 0o644 });
  await chmod(profilePath, 0o644);
  await writeFile(scriptPath, 'export default async function () {}\n');
  try {
    await assert.rejects(
      runBrowserTestSpace({
        url: 'https://example.test/', script: scriptPath, authProfile: profilePath, invocationDirectory,
      }),
      /owner-only/,
    );
  } finally {
    await rm(invocationDirectory, { recursive: true, force: true });
  }
});

test('browser run fails its completion invariant when the source profile changes', async () => {
  const invocationDirectory = await mkdtemp(join(tmpdir(), 'sigloo-browser-profile-change-test-'));
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Profile invariant</title>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const profilePath = join(invocationDirectory, 'auth-profile.json');
  const scriptPath = join(invocationDirectory, 'browser-test.mjs');
  await writeFile(profilePath, JSON.stringify({
    schema_version: 1, origin, cookies: [], local_storage: {},
  }), { mode: 0o600 });
  await chmod(profilePath, 0o600);
  await writeFile(scriptPath, `import { writeFile } from 'node:fs/promises';
    export default async function () { await writeFile(${JSON.stringify(profilePath)}, '{}'); }
  `);
  try {
    const { report } = await runBrowserTestSpace({
      url: `${origin}/`, script: scriptPath, authProfile: profilePath, invocationDirectory,
    });
    assert.equal(report.status, 'failed');
    assert.equal(report.auth_profile.unchanged, false);
    assert.equal(report.failure.type, 'InvariantError');
    assert.equal(report.cleanup.resources_remaining, false);
  } finally {
    server.close();
    await once(server, 'close');
    await rm(invocationDirectory, { recursive: true, force: true });
  }
});
