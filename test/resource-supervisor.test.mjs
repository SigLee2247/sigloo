import assert from 'node:assert/strict';
import test from 'node:test';
import { ResourceSupervisor } from '../src/supervisor/resource-supervisor.mjs';

test('Supervisor closes every resource in reverse order and keeps a failure receipt', async () => {
  const closed = [];
  const supervisor = new ResourceSupervisor();
  supervisor.register('profile', () => closed.push('profile'));
  supervisor.register('browser', () => { closed.push('browser'); throw new Error('simulated close failure'); });
  supervisor.register('viewer', () => closed.push('viewer'));
  const receipt = await supervisor.shutdown();
  assert.deepEqual(closed, ['viewer', 'browser', 'profile']);
  assert.deepEqual(receipt, {
    resources: [
      { name: 'viewer', closed: true },
      { name: 'browser', closed: false, error_type: 'Error' },
      { name: 'profile', closed: true },
    ],
    resources_remaining: true,
  });
  assert.equal(await supervisor.shutdown(), receipt);
});
