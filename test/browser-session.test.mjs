import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BrowserSessionStore } from '../src/browser-session.mjs';

test('persistent Browser Session creates, lists, inspects and destroys an isolated profile', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sigloo-browser-session-test-'));
  const previous = process.env.SIGLOO_DATA_ROOT;
  process.env.SIGLOO_DATA_ROOT = root;
  const store = new BrowserSessionStore();
  try {
    const created = await store.create('persistent-smoke', { ttlMs: 60_000 });
    assert.equal(created.state, 'ready');
    assert.match(created.cdp_url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal((await store.list()).length, 1);
    assert.equal((await store.inspect('persistent-smoke')).pid, created.pid);
    assert.deepEqual(await store.destroy('persistent-smoke'), { name: 'persistent-smoke', destroyed: true, resources_remaining: false });
    assert.equal((await store.list()).length, 0);
    const source = join(root, 'approved-profile'); await mkdir(source); await writeFile(join(source, 'marker'), 'fixture');
    const imported = await store.import('imported-smoke', source, { approved: true, ttlMs: 60_000 });
    assert.equal(imported.imported, true);
    await store.destroy('imported-smoke');
  } finally {
    if (previous === undefined) delete process.env.SIGLOO_DATA_ROOT; else process.env.SIGLOO_DATA_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});
