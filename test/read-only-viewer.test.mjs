import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BrowserSpace } from '../src/browser/browser-space.mjs';
import { CdpPipe } from '../src/browser/cdp-pipe.mjs';
import { BrowserViewer } from '../src/viewer/read-only-viewer.mjs';

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function waitUntil(assertion, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail('Timed out waiting for Viewer state');
}

test('Viewer requires explicit takeover, blocks agent control and returns it cleanly', async () => {
  const inputs = [];
  const viewer = new BrowserViewer({
    captureFrame: async () => PNG,
    dispatchInput: async (event) => inputs.push(event),
  });
  const url = await viewer.start();
  try {
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/space\/[a-f0-9]{48}$/);
    const page = await fetch(url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Read-only · Agent control/);
    assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);

    const frameUrl = url.replace('/space/', '/frame/');
    const frame = await fetch(frameUrl);
    assert.equal(frame.status, 200);
    assert.equal(frame.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await frame.arrayBuffer()), PNG);

    const controlUrl = url.replace('/space/', '/control/');
    const inputUrl = url.replace('/space/', '/input/');
    assert.equal((await fetch(inputUrl, { method: 'POST', body: '{}' })).status, 409);

    const takeover = await fetch(`${controlUrl}/takeover`, { method: 'POST', body: '{}' });
    assert.equal(takeover.status, 200);
    assert.equal((await takeover.json()).control_owner, 'user');
    let agentResumed = false;
    const agentControl = viewer.waitForAgentControl().then(() => { agentResumed = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(agentResumed, false);

    const input = { type: 'key', key: 'x' };
    assert.equal((await fetch(inputUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    })).status, 202);
    assert.deepEqual(inputs, [input]);

    const returned = await fetch(`${controlUrl}/return`, { method: 'POST', body: '{}' });
    assert.equal(returned.status, 200);
    await agentControl;
    assert.equal(agentResumed, true);
    assert.equal((await fetch(url.replace('/space/', '/space/not-the-token'))).status, 404);

    assert.deepEqual(viewer.report(), {
      enabled: true,
      mode: 'takeover-capable',
      control_owner: 'agent',
      page_requests: 1,
      frame_requests: 1,
      rejected_mutations: 1,
      takeover_count: 1,
      return_count: 1,
      input_events: 1,
      closed: false,
    });
  } finally {
    await viewer.close();
  }
  assert.equal(viewer.report().closed, true);
  await assert.rejects(fetch(url));
});

test('Viewer close interrupts rather than resumes agent work during user control', async () => {
  const viewer = new BrowserViewer({ captureFrame: async () => PNG });
  const url = await viewer.start();
  await fetch(`${url.replace('/space/', '/control/')}/takeover`, { method: 'POST', body: '{}' });
  const waiting = viewer.waitForAgentControl();
  await viewer.close();
  await assert.rejects(waiting, /closed before user returned control/);
  assert.equal(viewer.report().control_owner, 'agent');
});

test('Viewer controls work through its rendered page in stock Chrome', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'sigloo-viewer-ui-e2e-'));
  const inputs = [];
  const viewer = new BrowserViewer({
    captureFrame: async () => PNG,
    dispatchInput: async (event) => inputs.push(event),
  });
  let cdp;
  let page;
  try {
    const url = await viewer.start();
    cdp = await CdpPipe.launch(CHROME, [
      '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`,
      '--no-first-run', '--no-default-browser-check', '--disable-background-networking', 'about:blank',
    ]);
    page = await BrowserSpace.create(cdp, url, {
      origin: new URL(url).origin, cookies: [], local_storage: {},
    });
    await page.evaluate("document.querySelector('#take').click()");
    await waitUntil(() => viewer.report().control_owner === 'user');
    await page.evaluate("document.querySelector('#frame').dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }))");
    await waitUntil(() => inputs.length === 1);
    assert.deepEqual(inputs, [{ type: 'key', key: 'z' }]);
    await page.evaluate("document.querySelector('#return').click()");
    await waitUntil(() => viewer.report().control_owner === 'agent');
  } finally {
    if (page) await page.dispose();
    if (cdp) await cdp.close();
    await viewer.close();
    await rm(profile, { recursive: true, force: true });
  }
  assert.equal(viewer.report().closed, true);
});
