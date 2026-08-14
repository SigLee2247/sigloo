import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';

const LOOPBACK_HOST = '127.0.0.1';
const MAX_INPUT_BODY = 4_096;

function securityHeaders(contentType) {
  return {
    'cache-control': 'no-store',
    'content-type': contentType,
    'cross-origin-resource-policy': 'same-origin',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  };
}

function viewerHtml(nonce, paths) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sigloo Viewer</title>
  <style nonce="${nonce}">
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; background: #10151d; color: #edf4ff; }
    header { display: flex; gap: 12px; align-items: center; padding: 12px 16px; background: #17202b; }
    button { border: 1px solid #79c0ff; border-radius: 8px; padding: 6px 10px; color: #edf4ff; background: #243244; }
    button[hidden] { display: none; }
    .badge { border: 1px solid #79c0ff; border-radius: 999px; padding: 3px 9px; color: #79c0ff; font-size: 12px; }
    main { display: grid; place-items: center; padding: 16px; }
    img { display: block; max-width: 100%; max-height: calc(100vh - 82px); box-shadow: 0 8px 32px #0008; }
    body.user-control img { cursor: crosshair; outline: 2px solid #f6c177; }
  </style>
</head>
<body>
  <header>
    <strong>Sigloo Viewer</strong><span id="badge" class="badge">Read-only · Agent control</span>
    <button id="take">Take control</button><button id="return" hidden>Return to agent</button>
  </header>
  <main><img id="frame" alt="Current Browser Space frame" tabindex="0"></main>
  <script nonce="${nonce}">
    const frame = document.querySelector('#frame');
    const badge = document.querySelector('#badge');
    const take = document.querySelector('#take');
    const giveBack = document.querySelector('#return');
    let owner = 'agent';
    const post = (path, body) => fetch(path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {})
    });
    const renderOwner = () => {
      const user = owner === 'user';
      document.body.classList.toggle('user-control', user);
      badge.textContent = user ? 'Interactive · User control' : 'Read-only · Agent control';
      take.hidden = user; giveBack.hidden = !user;
    };
    take.addEventListener('click', async () => {
      const response = await post(${JSON.stringify(paths.takeover)});
      if (response.ok) { owner = 'user'; renderOwner(); frame.focus(); }
    });
    giveBack.addEventListener('click', async () => {
      const response = await post(${JSON.stringify(paths.returnControl)});
      if (response.ok) { owner = 'agent'; renderOwner(); }
    });
    frame.addEventListener('pointerdown', (event) => {
      if (owner !== 'user') return;
      const bounds = frame.getBoundingClientRect();
      const x = (event.clientX - bounds.left) * frame.naturalWidth / bounds.width;
      const y = (event.clientY - bounds.top) * frame.naturalHeight / bounds.height;
      void post(${JSON.stringify(paths.input)}, { type: 'pointer', x, y, button: 'left' });
      frame.focus();
    });
    frame.addEventListener('keydown', (event) => {
      if (owner !== 'user') return;
      event.preventDefault();
      void post(${JSON.stringify(paths.input)}, { type: 'key', key: event.key });
    });
    const refresh = () => { frame.src = ${JSON.stringify(paths.frame)} + '?frame=' + Date.now(); };
    frame.addEventListener('load', () => setTimeout(refresh, 500));
    frame.addEventListener('error', () => setTimeout(refresh, 1000));
    renderOwner(); refresh();
  </script>
</body>
</html>`;
}

async function readJsonBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_INPUT_BODY) throw new Error('Viewer input is too large');
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString('utf8');
  return body ? JSON.parse(body) : {};
}

export class BrowserViewer {
  constructor({ captureFrame, dispatchInput = async () => {} }) {
    if (typeof captureFrame !== 'function') throw new Error('Viewer requires a frame capture function');
    if (typeof dispatchInput !== 'function') throw new Error('Viewer requires an input dispatch function');
    this.captureFrame = captureFrame;
    this.dispatchInput = dispatchInput;
    this.token = randomBytes(24).toString('hex');
    this.nonce = randomBytes(18).toString('base64');
    this.paths = {
      page: `/space/${this.token}`,
      frame: `/frame/${this.token}`,
      takeover: `/control/${this.token}/takeover`,
      returnControl: `/control/${this.token}/return`,
      input: `/input/${this.token}`,
    };
    this.server = null;
    this.capture = Promise.resolve();
    this.controlOwner = 'agent';
    this.agentWaiters = [];
    this.metrics = {
      page_requests: 0, frame_requests: 0, rejected_mutations: 0,
      takeover_count: 0, return_count: 0, input_events: 0,
    };
    this.closed = false;
  }

  async start() {
    if (this.server) throw new Error('Viewer is already running');
    this.server = createServer((request, response) => { void this.#handle(request, response); });
    this.server.listen(0, LOOPBACK_HOST);
    await once(this.server, 'listening');
    const { port } = this.server.address();
    return `http://${LOOPBACK_HOST}:${port}${this.paths.page}`;
  }

  waitForAgentControl() {
    if (this.closed) return Promise.reject(new Error('Viewer closed before agent control returned'));
    if (this.controlOwner === 'agent') return Promise.resolve();
    return new Promise((resolveWaiter, rejectWaiter) => this.agentWaiters.push({ resolveWaiter, rejectWaiter }));
  }

  #setControlOwner(owner) {
    if (this.controlOwner === owner) return false;
    this.controlOwner = owner;
    if (owner === 'agent') this.agentWaiters.splice(0).forEach(({ resolveWaiter }) => resolveWaiter());
    return true;
  }

  async #handle(request, response) {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (['GET', 'HEAD'].includes(request.method)) return await this.#handleRead(request, response, pathname);
      if (request.method === 'POST' && pathname === this.paths.takeover) {
        if (this.#setControlOwner('user')) this.metrics.takeover_count += 1;
        response.writeHead(200, securityHeaders('application/json'));
        response.end(JSON.stringify({ control_owner: this.controlOwner }));
        return;
      }
      if (request.method === 'POST' && pathname === this.paths.returnControl) {
        if (this.#setControlOwner('agent')) this.metrics.return_count += 1;
        response.writeHead(200, securityHeaders('application/json'));
        response.end(JSON.stringify({ control_owner: this.controlOwner }));
        return;
      }
      if (request.method === 'POST' && pathname === this.paths.input) {
        if (this.controlOwner !== 'user') {
          this.metrics.rejected_mutations += 1;
          response.writeHead(409, securityHeaders('application/json'));
          response.end(JSON.stringify({ error: 'USER_CONTROL_REQUIRED' }));
          return;
        }
        await this.dispatchInput(await readJsonBody(request));
        this.metrics.input_events += 1;
        response.writeHead(202, securityHeaders('application/json'));
        response.end(JSON.stringify({ accepted: true }));
        return;
      }
      this.metrics.rejected_mutations += 1;
      response.writeHead(405, { ...securityHeaders('text/plain; charset=utf-8'), allow: 'GET, HEAD, POST' });
      response.end('Viewer mutation route is not allowed');
    } catch {
      if (!response.headersSent) response.writeHead(400, securityHeaders('text/plain; charset=utf-8'));
      response.end('Viewer request rejected');
    }
  }

  async #handleRead(request, response, pathname) {
    if (pathname === this.paths.page) {
      this.metrics.page_requests += 1;
      const html = viewerHtml(this.nonce, this.paths);
      response.writeHead(200, {
        ...securityHeaders('text/html; charset=utf-8'),
        'content-security-policy': `default-src 'none'; img-src 'self'; connect-src 'self'; script-src 'nonce-${this.nonce}'; style-src 'nonce-${this.nonce}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
      });
      response.end(request.method === 'HEAD' ? undefined : html);
      return;
    }
    if (pathname === this.paths.frame) {
      this.metrics.frame_requests += 1;
      let png;
      if (request.method === 'GET') {
        this.capture = this.capture.catch(() => {}).then(() => this.captureFrame());
        png = await this.capture;
      }
      response.writeHead(200, securityHeaders('image/png'));
      response.end(png);
      return;
    }
    response.writeHead(404, securityHeaders('text/plain; charset=utf-8'));
    response.end(request.method === 'HEAD' ? undefined : 'Not found');
  }

  async close() {
    if (!this.server || this.closed) return;
    if (this.controlOwner === 'user') {
      this.controlOwner = 'agent';
      const error = new Error('Viewer closed before user returned control');
      this.agentWaiters.splice(0).forEach(({ rejectWaiter }) => rejectWaiter(error));
    }
    const closed = once(this.server, 'close');
    this.server.close();
    this.server.closeIdleConnections?.();
    this.server.closeAllConnections?.();
    await closed;
    this.closed = true;
  }

  report() {
    return {
      enabled: true,
      mode: 'takeover-capable',
      control_owner: this.controlOwner,
      ...this.metrics,
      closed: this.closed,
    };
  }
}

export const ReadOnlyViewer = BrowserViewer;
