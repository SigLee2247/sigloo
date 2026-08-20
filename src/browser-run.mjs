import { randomUUID } from 'node:crypto';
import { access, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserSpace } from './browser/browser-space.mjs';
import { CdpPipe } from './browser/cdp-pipe.mjs';
import { loadAuthProfile, sha256 } from './browser/auth-profile.mjs';
import { BrowserViewer } from './viewer/read-only-viewer.mjs';
import { ResourceSupervisor } from './supervisor/resource-supervisor.mjs';
import { createManagedTemporaryDirectory } from './supervisor/managed-temporary.mjs';
import { writeRunReports } from './report-renderer.mjs';

const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function createSpaceId(name) {
  const time = new Date().toISOString().replaceAll(/[-:.TZ]/g, '');
  return `${name}-${time}-${randomUUID().slice(0, 8)}`;
}

function validateName(value, label = 'name') {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) {
    throw new Error(`${label} must be 1-64 letters, numbers, dots, underscores or hyphens`);
  }
}

async function loadTestModule(path, invocationDirectory) {
  const absolutePath = resolve(invocationDirectory, path);
  const metadata = await lstat(absolutePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('Browser test script must be a regular file');
  if (metadata.size > 1_048_576) throw new Error('Browser test script must not exceed 1 MiB');
  const bytes = await readFile(absolutePath);
  const module = await import(`${pathToFileURL(absolutePath).href}?sigloo=${sha256(bytes)}`);
  if (typeof module.default !== 'function') throw new Error('Browser test script must export a default function');
  return { absolutePath, digest: sha256(bytes), run: module.default };
}

async function withTimeout(operation, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Browser test timed out')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function runBrowserTestSpace({
  name = 'browser-e2e',
  url,
  script,
  authProfile,
  invocationDirectory = process.cwd(),
  evidenceDirectory = '.sigloo/evidence',
  timeoutMs = 30_000,
  viewer = false,
  viewerHoldMs = viewer ? 3_000 : 0,
  onViewerReady = () => {},
  chromePath = process.env.SIGLOO_CHROME_PATH ?? DEFAULT_CHROME,
} = {}) {
  validateName(name, 'Space name');
  if (!url) throw new Error('Browser run requires --url');
  const parsedUrl = new URL(url);
  if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
    throw new Error('Browser run URL must be HTTP(S) without embedded credentials');
  }
  const initialUrl = parsedUrl.href;
  const loadedProfile = await loadAuthProfile(authProfile, invocationDirectory);
  if (new URL(initialUrl).origin !== loadedProfile.profile.origin) {
    throw new Error('Initial URL origin must match the Auth Profile origin');
  }
  const loadedTest = await loadTestModule(script, invocationDirectory);
  if (typeof viewer !== 'boolean') throw new Error('Viewer option must be boolean');
  if (!Number.isInteger(viewerHoldMs) || viewerHoldMs < 0 || viewerHoldMs > 300_000) {
    throw new Error('Viewer hold must be an integer between 0 and 300000');
  }
  if (typeof onViewerReady !== 'function') throw new Error('Viewer ready callback must be a function');
  const id = createSpaceId(name);
  const startedAt = new Date().toISOString();
  const temporaryProfile = await createManagedTemporaryDirectory('sigloo-browser-run-');
  const supervisor = new ResourceSupervisor();
  supervisor.register('temporary-profile', () => rm(temporaryProfile, { recursive: true, force: true }));
  const evidenceRoot = resolve(invocationDirectory, evidenceDirectory);
  const artifactRoot = join(evidenceRoot, `${id}-artifacts`);
  const evidencePath = join(evidenceRoot, `${id}.json`);
  const checks = [];
  const artifacts = [];
  const actions = [];
  let cdp;
  let space;
  let browserViewer;
  let status = 'failed';
  let failure = null;
  let browserExited = true;
  let temporaryProfileRemoved = false;
  let authProfileUnchanged = false;
  let supervisorReceipt;

  try {
    cdp = await CdpPipe.launch(chromePath, [
      '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${temporaryProfile}`,
      '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
      '--disable-component-update', '--disable-sync', 'about:blank',
    ]);
    supervisor.register('browser-process', () => cdp.close());
    space = await BrowserSpace.create(cdp, initialUrl, loadedProfile.profile);
    supervisor.register('browser-context', () => space.dispose());
    if (viewer) {
      browserViewer = new BrowserViewer({
        captureFrame: () => space.captureScreenshot(),
        dispatchInput: (event) => space.dispatchInput(event),
      });
      const viewerUrl = await browserViewer.start();
      supervisor.register('viewer', () => browserViewer.close());
      await onViewerReady({
        spaceId: id, url: viewerUrl, mode: 'takeover-capable', controlOwner: 'agent',
      });
    }
    const withAgentControl = async (operation) => {
      if (browserViewer) await browserViewer.waitForAgentControl();
      return operation();
    };
    const performAction = async (action, targetRef, operation) => {
      if (actions.length >= 2_000) throw new Error('Browser action limit exceeded');
      const startedAt = new Date().toISOString();
      actions.push({ action, target_ref: targetRef, status: 'started', at: startedAt });
      try {
        const result = await withAgentControl(operation);
        actions.push({
          action, target_ref: targetRef, status: 'passed', at: new Date().toISOString(),
          ...(action === 'snapshot' ? { element_count: result.elements.length } : {}),
        });
        return result;
      } catch (error) {
        actions.push({ action, target_ref: targetRef, status: 'failed', at: new Date().toISOString() });
        throw error;
      }
    };
    const api = Object.freeze({
      spaceId: id,
      goto: (target) => withAgentControl(() => space.goto(target)),
      evaluate: (expression) => withAgentControl(() => space.evaluate(expression)),
      getCookie: (key) => withAgentControl(() => space.getCookie(key)),
      setCookie: (key, value) => withAgentControl(() => space.setCookie(key, value)),
      getLocalStorage: (key) => withAgentControl(() => space.getLocalStorage(key)),
      setLocalStorage: (key, value) => withAgentControl(() => space.setLocalStorage(key, value)),
      snapshot: () => performAction('snapshot', null, () => space.snapshot()),
      click: (ref) => performAction('click', ref, () => space.click(ref)),
      fill: (ref, value) => performAction('fill', ref, () => space.fill(ref, value)),
      key: (ref, key) => performAction('key', ref, () => space.key(ref, key)),
      assert(assertionName, condition) {
        validateName(assertionName, 'Assertion name');
        if (checks.some((check) => check.name === assertionName)) {
          throw new Error('Assertion names must be unique');
        }
        const passed = condition === true;
        checks.push({ name: assertionName, passed });
        if (!passed) throw new Error('Named browser assertion failed');
      },
      async screenshot(artifactName) {
        if (browserViewer) await browserViewer.waitForAgentControl();
        validateName(artifactName, 'Artifact name');
        if (artifacts.some((artifact) => artifact.name === artifactName)) {
          throw new Error('Artifact names must be unique');
        }
        await mkdir(artifactRoot, { recursive: true });
        const path = join(artifactRoot, `${artifactName}.png`);
        await writeFile(path, await space.captureScreenshot(), { mode: 0o600 });
        artifacts.push({ name: artifactName, path, media_type: 'image/png' });
        return path;
      },
    });
    await withTimeout(Promise.resolve(loadedTest.run(api)), timeoutMs);
    status = 'passed';
  } catch (error) {
    failure = {
      type: error?.name ?? 'Error',
      message_digest: sha256(Buffer.from(String(error?.message ?? 'unknown failure'))),
    };
  } finally {
    if (browserViewer && viewerHoldMs > 0) {
      await new Promise((resolveHold) => setTimeout(resolveHold, viewerHoldMs));
    }
    supervisorReceipt = await supervisor.shutdown();
    browserExited = cdp ? !cdp.isRunning : true;
    try { await access(temporaryProfile); } catch { temporaryProfileRemoved = true; }
    try {
      const currentProfile = await readFile(loadedProfile.path);
      authProfileUnchanged = sha256(currentProfile) === loadedProfile.digest;
    } catch {
      authProfileUnchanged = false;
    }
  }

  const cleanup = {
    browser_exited: browserExited,
    temporary_profile_removed: temporaryProfileRemoved,
    viewer_closed: browserViewer ? browserViewer.closed : true,
    resources_remaining: supervisorReceipt.resources_remaining || !(browserExited && temporaryProfileRemoved && (!browserViewer || browserViewer.closed)),
    supervisor: supervisorReceipt,
  };
  if (cleanup.resources_remaining || !authProfileUnchanged) {
    status = 'failed';
    failure ??= {
      type: 'InvariantError',
      message_digest: sha256(Buffer.from('Browser run completion invariant failed')),
    };
  }
  const report = {
    schema_version: 1,
    space_id: id,
    name,
    driver: 'browser',
    isolation_level: 'chromium-browser-context',
    status,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    browser: { executable: basename(chromePath), headless: true },
    viewer: browserViewer ? browserViewer.report() : {
      enabled: false,
      mode: null,
      control_owner: null,
      page_requests: 0,
      frame_requests: 0,
      rejected_mutations: 0,
      takeover_count: 0,
      return_count: 0,
      input_events: 0,
      closed: true,
    },
    test: {
      title: `${name} Browser Space 실행 검증`,
      purpose: `격리된 BrowserContext에서 ${initialUrl}을 열고 Auth Profile 파생 상태와 브라우저 상호작용을 확인한다.`,
      preconditions: ['동일 origin의 owner-only Auth Profile이 준비되어 있다.', '브라우저 테스트 모듈이 default function을 export한다.'],
      steps: ['임시 Chrome 프로필 생성', 'BrowserContext 및 Auth Profile 파생', '테스트 script의 snapshot/action/assert 실행', 'screenshot·viewer·브라우저 리소스 cleanup 확인'],
      success_criteria: ['named assertion이 모두 통과한다.', 'Auth Profile 원본이 변경되지 않는다.', 'resources_remaining이 false이다.'],
      script_digest: loadedTest.digest, checks, actions,
    },
    auth_profile: {
      digest: loadedProfile.digest,
      origin: loadedProfile.profile.origin,
      cookie_count: loadedProfile.profile.cookies.length,
      local_storage_count: Object.keys(loadedProfile.profile.local_storage).length,
      unchanged: authProfileUnchanged,
    },
    artifacts,
    failure,
    cleanup,
  };
  const reportPaths = await writeRunReports(report, evidenceRoot, evidencePath);
  return { report, ...reportPaths };
}
