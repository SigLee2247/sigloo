import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createManagedTemporaryDirectory, recoverManagedTemporaryDirectories } from '../src/supervisor/managed-temporary.mjs';

test('managed temporary recovery preserves active owners and removes exited owners', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sigloo-managed-temp-test-'));
  try {
    const managed = await createManagedTemporaryDirectory('sigloo-browser-run-', { directory: root });
    let receipt = await recoverManagedTemporaryDirectories({ directory: root });
    assert.equal(receipt.active, 1);
    const markerPath = join(managed, '.sigloo-owner.json');
    const marker = JSON.parse(await readFile(markerPath, 'utf8'));
    marker.pid = 2_147_483_647;
    await writeFile(markerPath, `${JSON.stringify(marker)}\n`, { mode: 0o600 });
    receipt = await recoverManagedTemporaryDirectories({ directory: root });
    assert.equal(receipt.recovered, 1);
    assert.equal(receipt.resources_remaining, false);
    await assert.rejects(access(managed));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
