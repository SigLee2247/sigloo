import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { CdpPipe } from './cdp-pipe.mjs';
import { BrowserSpace } from './browser-space.mjs';

const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export async function runBrowserSpaceSpike({
  chromePath = process.env.SIGLOO_CHROME_PATH ?? DEFAULT_CHROME,
  spaceCount = 6,
} = {}) {
  const startedAt = new Date().toISOString();
  const profileDirectory = await mkdtemp(join(tmpdir(), 'sigloo-browser-spike-'));
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Sigloo Browser Space Spike</title>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  let cdp;
  const spaces = [];
  let chromePid = null;
  let result;

  const authProfile = Object.freeze({
    cookies: Object.freeze([{ name: 'sigloo_session', value: 'seed-session' }]),
    localStorage: Object.freeze({ sigloo_auth: 'seed-state' }),
  });

  try {
    cdp = await CdpPipe.launch(chromePath, [
      '--headless=new',
      '--remote-debugging-pipe',
      `--user-data-dir=${profileDirectory}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      'about:blank',
    ]);
    chromePid = cdp.pid;

    for (let index = 0; index < spaceCount; index += 1) {
      spaces.push(await BrowserSpace.create(cdp, origin, authProfile));
    }
    const [first, ...others] = spaces;

    for (const space of spaces) {
      assert.equal(await space.getCookie('sigloo_session'), 'seed-session');
      assert.equal(await space.getLocalStorage('sigloo_auth'), 'seed-state');
    }

    await first.setCookie('sigloo_session', 'first-mutated');
    await first.setLocalStorage('sigloo_auth', 'first-mutated');

    assert.equal(await first.getCookie('sigloo_session'), 'first-mutated');
    assert.equal(await first.getLocalStorage('sigloo_auth'), 'first-mutated');
    for (const space of others) {
      assert.equal(await space.getCookie('sigloo_session'), 'seed-session');
      assert.equal(await space.getLocalStorage('sigloo_auth'), 'seed-state');
    }
    assert.equal(authProfile.cookies[0].value, 'seed-session');
    assert.equal(authProfile.localStorage.sigloo_auth, 'seed-state');

    result = {
      status: 'passed',
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      chrome_path: chromePath,
      chrome_pid: chromePid,
      contexts_created: spaceCount,
      assertions: {
        shared_starting_cookie: true,
        shared_starting_local_storage: true,
        cookie_mutation_isolated: true,
        local_storage_mutation_isolated: true,
        auth_profile_unchanged: true,
      },
    };
  } finally {
    for (const space of spaces.reverse()) {
      try {
        await space.dispose();
      } catch {
        // Browser shutdown below remains the final cleanup boundary.
      }
    }
    if (cdp) await cdp.close();
    const browserExited = cdp ? !cdp.isRunning : true;
    server.close();
    await once(server, 'close');
    await rm(profileDirectory, { recursive: true, force: true });
    let profileRemoved = false;
    try {
      await access(profileDirectory);
    } catch {
      profileRemoved = true;
    }
    if (result) {
      result.cleanup = {
        browser_exited: browserExited,
        temporary_profile_removed: profileRemoved,
        resources_remaining: !(browserExited && profileRemoved),
      };
    }
  }
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runBrowserSpaceSpike();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
