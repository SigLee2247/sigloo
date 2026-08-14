import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SpaceError, SpaceStore, parseTtl } from '../src/space-store.mjs';

test('TTL parsing is bounded', () => {
  assert.equal(parseTtl('30m'), 1_800_000);
  assert.equal(parseTtl('7d'), 604_800_000);
  assert.throws(() => parseTtl('0s'), { code: 'INVALID_TTL' });
  assert.throws(() => parseTtl('8d'), { code: 'INVALID_TTL' });
});

test('direct Space creation rejects an unbounded TTL', async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'sigloo-space-store-ttl-test-'));
  const store = new SpaceStore({ dataRoot, ownerId: 'owner-a' });
  try {
    await assert.rejects(store.create('bad-ttl', 0), { code: 'INVALID_TTL' });
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test('expired Space is reaped with a cleanup receipt', async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'sigloo-space-store-test-'));
  let now = new Date('2026-08-14T00:00:00.000Z');
  const store = new SpaceStore({ dataRoot, ownerId: 'owner-a', now: () => now });
  try {
    const created = await store.create('ttl-e2e', 1_000);
    now = new Date('2026-08-14T00:00:02.000Z');
    await assert.rejects(store.inspect(created.id), (error) =>
      error instanceof SpaceError && error.code === 'SPACE_EXPIRED' && error.exitCode === 4);
    const expired = (await store.list()).find((space) => space.id === created.id);
    assert.equal(expired.state, 'expired');
    assert.equal(expired.cleanup.space_directory_removed, true);
    assert.equal(expired.cleanup.resources_remaining, false);
    await assert.rejects(access(created.work_path));
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});
