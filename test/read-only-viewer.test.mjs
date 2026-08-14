import assert from 'node:assert/strict';
import test from 'node:test';
import { ReadOnlyViewer } from '../src/viewer/read-only-viewer.mjs';

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

test('read-only Viewer exposes frames without an input route and closes cleanly', async () => {
  const viewer = new ReadOnlyViewer({ captureFrame: async () => PNG });
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

    const mutation = await fetch(url, { method: 'POST' });
    assert.equal(mutation.status, 405);
    assert.equal(mutation.headers.get('allow'), 'GET, HEAD');
    assert.equal((await fetch(url.replace('/space/', '/space/not-the-token'))).status, 404);

    assert.deepEqual(viewer.report(), {
      enabled: true,
      mode: 'read-only',
      control_owner: 'agent',
      page_requests: 1,
      frame_requests: 1,
      rejected_mutations: 1,
      closed: false,
    });
  } finally {
    await viewer.close();
  }
  assert.equal(viewer.report().closed, true);
  await assert.rejects(fetch(url));
});
