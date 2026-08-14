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
    response.end('<!doctype html><title>Sigloo browser run</title><main id="result">ready</main><input id="user-input" aria-label="Account" style="position:fixed;left:20px;top:20px;width:200px;height:40px"><button id="submit" onclick="document.querySelector(`#result`).textContent=`submitted`">Submit</button>');
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
    page.assert('takeover-input', await page.evaluate("document.querySelector('#user-input').value") === 'human42');
    const snapshot = await page.snapshot();
    const input = snapshot.elements.find((element) => element.name === 'Account');
    const submit = snapshot.elements.find((element) => element.name === 'Submit');
    page.assert('semantic-elements', Boolean(input && submit));
    await page.fill(input.ref, 'agent-secret-value');
    await page.key(input.ref, 'x');
    await page.click(submit.ref);
    page.assert('semantic-fill-key', await page.evaluate("document.querySelector('#user-input').value") === 'agent-secret-valuex');
    page.assert('semantic-click', await page.evaluate("document.querySelector('#result').textContent") === 'submitted');
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
      viewer: true,
      viewerHoldMs: 0,
      async onViewerReady({ url: viewerUrl, mode, controlOwner }) {
        assert.equal(mode, 'takeover-capable');
        assert.equal(controlOwner, 'agent');
        const page = await fetch(viewerUrl);
        assert.equal(page.status, 200);
        assert.match(await page.text(), /Sigloo Viewer/);
        const frame = await fetch(viewerUrl.replace('/space/', '/frame/'));
        assert.equal(frame.status, 200);
        assert.deepEqual([...Buffer.from(await frame.arrayBuffer()).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
        assert.equal((await fetch(viewerUrl, { method: 'POST' })).status, 405);
        const controlUrl = viewerUrl.replace('/space/', '/control/');
        const inputUrl = viewerUrl.replace('/space/', '/input/');
        assert.equal((await fetch(`${controlUrl}/takeover`, { method: 'POST', body: '{}' })).status, 200);
        for (const input of [
          { type: 'pointer', x: 40, y: 40, button: 'left' },
          ...[...'human42'].map((key) => ({ type: 'key', key })),
        ]) {
          assert.equal((await fetch(inputUrl, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
          })).status, 202);
        }
        assert.equal((await fetch(`${controlUrl}/return`, { method: 'POST', body: '{}' })).status, 200);
      },
    });
    assert.equal(report.status, 'passed');
    assert.deepEqual(report.test.checks, [
      { name: 'cookie-derived', passed: true },
      { name: 'storage-derived', passed: true },
      { name: 'page-loaded', passed: true },
      { name: 'takeover-input', passed: true },
      { name: 'semantic-elements', passed: true },
      { name: 'semantic-fill-key', passed: true },
      { name: 'semantic-click', passed: true },
    ]);
    assert.equal(report.auth_profile.unchanged, true);
    assert.equal(report.artifacts.length, 1);
    const screenshot = await readFile(report.artifacts[0].path);
    assert.deepEqual([...screenshot.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(report.cleanup.resources_remaining, false);
    assert.deepEqual(report.viewer, {
      enabled: true,
      mode: 'takeover-capable',
      control_owner: 'agent',
      page_requests: 1,
      frame_requests: 1,
      rejected_mutations: 1,
      takeover_count: 1,
      return_count: 1,
      input_events: 8,
      closed: true,
    });
    assert.equal(report.cleanup.viewer_closed, true);
    assert.equal(await readFile(profilePath, 'utf8'), profileBytes);
    const evidence = await readFile(evidencePath, 'utf8');
    assert.doesNotMatch(evidence, /profile-cookie-secret|profile-storage-secret|space-only-cookie|space-only-storage/);
    assert.doesNotMatch(evidence, /human42/);
    assert.doesNotMatch(evidence, /agent-secret-value/);
    assert.deepEqual(report.test.actions.map(({ action, status }) => ({ action, status })), [
      { action: 'snapshot', status: 'started' }, { action: 'snapshot', status: 'passed' },
      { action: 'fill', status: 'started' }, { action: 'fill', status: 'passed' },
      { action: 'key', status: 'started' }, { action: 'key', status: 'passed' },
      { action: 'click', status: 'started' }, { action: 'click', status: 'passed' },
    ]);
    assert.doesNotMatch(evidence, /127\.0\.0\.1:\d+\/space\//);
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
      '--script', scriptPath, '--auth-profile', profilePath, '--viewer', '--viewer-hold-ms', '0',
    ], { cwd: invocationDirectory, timeout: 20_000 });
    const viewerLine = stdout.split('\n').find((line) => line.startsWith('SIGLOO_VIEWER '));
    assert.ok(viewerLine);
    const viewer = JSON.parse(viewerLine.slice('SIGLOO_VIEWER '.length));
    assert.equal(viewer.mode, 'takeover-capable');
    assert.equal(viewer.control_owner, 'agent');
    assert.match(viewer.url, /^http:\/\/127\.0\.0\.1:\d+\/space\/[a-f0-9]{48}$/);
    const receiptLine = stdout.split('\n').find((line) => line.startsWith('SIGLOO_RECEIPT '));
    assert.ok(receiptLine);
    const receipt = JSON.parse(receiptLine.slice('SIGLOO_RECEIPT '.length));
    assert.equal(receipt.status, 'passed');
    assert.equal(receipt.auth_profile_unchanged, true);
    assert.equal(receipt.cleanup.resources_remaining, false);
    assert.equal(receipt.artifacts.length, 0);
    assert.equal(receipt.viewer.enabled, true);
    assert.equal(receipt.viewer.closed, true);
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
