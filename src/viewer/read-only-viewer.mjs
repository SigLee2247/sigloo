import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';

const LOOPBACK_HOST = '127.0.0.1';

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

function viewerHtml(nonce, framePath) {
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
    .badge { border: 1px solid #79c0ff; border-radius: 999px; padding: 3px 9px; color: #79c0ff; font-size: 12px; }
    main { display: grid; place-items: center; padding: 16px; }
    img { display: block; max-width: 100%; max-height: calc(100vh - 82px); box-shadow: 0 8px 32px #0008; }
  </style>
</head>
<body>
  <header><strong>Sigloo Viewer</strong><span class="badge">Read-only · Agent control</span></header>
  <main><img id="frame" alt="Current Browser Space frame"></main>
  <script nonce="${nonce}">
    const frame = document.querySelector('#frame');
    const refresh = () => {
      frame.src = ${JSON.stringify(framePath)} + '?frame=' + Date.now();
    };
    frame.addEventListener('load', () => setTimeout(refresh, 500));
    frame.addEventListener('error', () => setTimeout(refresh, 1000));
    refresh();
  </script>
</body>
</html>`;
}

export class ReadOnlyViewer {
  constructor({ captureFrame }) {
    if (typeof captureFrame !== 'function') throw new Error('Viewer requires a frame capture function');
    this.captureFrame = captureFrame;
    this.token = randomBytes(24).toString('hex');
    this.nonce = randomBytes(18).toString('base64');
    this.pagePath = `/space/${this.token}`;
    this.framePath = `/frame/${this.token}`;
    this.server = null;
    this.capture = Promise.resolve();
    this.metrics = { page_requests: 0, frame_requests: 0, rejected_mutations: 0 };
    this.closed = false;
  }

  async start() {
    if (this.server) throw new Error('Viewer is already running');
    this.server = createServer((request, response) => {
      void this.#handle(request, response);
    });
    this.server.listen(0, LOOPBACK_HOST);
    await once(this.server, 'listening');
    const { port } = this.server.address();
    return `http://${LOOPBACK_HOST}:${port}${this.pagePath}`;
  }

  async #handle(request, response) {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) {
        this.metrics.rejected_mutations += 1;
        response.writeHead(405, { ...securityHeaders('text/plain; charset=utf-8'), allow: 'GET, HEAD' });
        response.end(request.method === 'HEAD' ? undefined : 'Viewer is read-only');
        return;
      }
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname === this.pagePath) {
        this.metrics.page_requests += 1;
        const html = viewerHtml(this.nonce, this.framePath);
        response.writeHead(200, {
          ...securityHeaders('text/html; charset=utf-8'),
          'content-security-policy': `default-src 'none'; img-src 'self'; script-src 'nonce-${this.nonce}'; style-src 'nonce-${this.nonce}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
        });
        response.end(request.method === 'HEAD' ? undefined : html);
        return;
      }
      if (pathname === this.framePath) {
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
    } catch {
      if (!response.headersSent) response.writeHead(503, securityHeaders('text/plain; charset=utf-8'));
      response.end(request.method === 'HEAD' ? undefined : 'Frame unavailable');
    }
  }

  async close() {
    if (!this.server || this.closed) return;
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
      mode: 'read-only',
      control_owner: 'agent',
      ...this.metrics,
      closed: this.closed,
    };
  }
}
