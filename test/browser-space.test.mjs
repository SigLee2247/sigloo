import test from 'node:test';
import assert from 'node:assert/strict';
import { runBrowserSpaceSpike } from '../spikes/browser-space/run.mjs';

test('derives isolated Browser Spaces from one Auth Profile', async () => {
  const result = await runBrowserSpaceSpike();
  assert.equal(result.status, 'passed');
  assert.equal(result.contexts_created, 6);
  assert.deepEqual(result.assertions, {
    shared_starting_cookie: true,
    shared_starting_local_storage: true,
    cookie_mutation_isolated: true,
    local_storage_mutation_isolated: true,
    auth_profile_unchanged: true,
  });
  assert.deepEqual(result.cleanup, {
    browser_exited: true,
    temporary_profile_removed: true,
    resources_remaining: false,
  });
});
