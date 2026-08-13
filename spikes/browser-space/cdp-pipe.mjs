import { spawn } from 'node:child_process';

const MESSAGE_SEPARATOR = 0;

export class CdpPipe {
  #child;
  #input;
  #nextId = 1;
  #pending = new Map();
  #events = new Map();
  #buffer = Buffer.alloc(0);
  #stderr = '';

  static async launch(executable, args) {
    const child = spawn(executable, args, {
      stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
    });
    const client = new CdpPipe(child);
    await client.send('Browser.getVersion');
    return client;
  }

  constructor(child) {
    this.#child = child;
    this.#input = child.stdio[3];
    child.stdio[4].on('data', (chunk) => this.#consume(chunk));
    child.stderr.on('data', (chunk) => {
      this.#stderr += chunk.toString('utf8');
    });
    child.once('error', (error) => this.#rejectAll(error));
    child.once('exit', (code, signal) => {
      this.#rejectAll(new Error(`Chrome exited unexpectedly: code=${code} signal=${signal}\n${this.#stderr}`));
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.#nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 10_000);
      this.#pending.set(id, { resolve, reject, timer, method });
      this.#input.write(`${JSON.stringify(message)}\0`);
    });
  }

  waitFor(method, sessionId) {
    const key = `${sessionId ?? ''}:${method}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const listeners = this.#events.get(key) ?? [];
        this.#events.set(key, listeners.filter((entry) => entry.resolve !== resolve));
        reject(new Error(`CDP event timeout: ${method}`));
      }, 10_000);
      const listeners = this.#events.get(key) ?? [];
      listeners.push({ resolve, timer });
      this.#events.set(key, listeners);
    });
  }

  async close() {
    if (this.#child.exitCode !== null) return;
    const exited = new Promise((resolve) => this.#child.once('exit', resolve));
    try {
      await this.send('Browser.close');
    } catch {
      this.#child.kill('SIGTERM');
    }
    await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(resolve, 3_000)),
    ]);
    if (this.#child.exitCode === null) {
      this.#child.kill('SIGKILL');
      await exited;
    }
  }

  get pid() {
    return this.#child.pid;
  }

  get isRunning() {
    return this.#child.exitCode === null;
  }

  #consume(chunk) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    let separatorIndex;
    while ((separatorIndex = this.#buffer.indexOf(MESSAGE_SEPARATOR)) !== -1) {
      const frame = this.#buffer.subarray(0, separatorIndex);
      this.#buffer = this.#buffer.subarray(separatorIndex + 1);
      if (frame.length === 0) continue;
      this.#handle(JSON.parse(frame.toString('utf8')));
    }
  }

  #handle(message) {
    if (message.id) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.#pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }

    const key = `${message.sessionId ?? ''}:${message.method}`;
    const listeners = this.#events.get(key) ?? [];
    const listener = listeners.shift();
    if (!listener) return;
    clearTimeout(listener.timer);
    listener.resolve(message.params ?? {});
    if (listeners.length === 0) this.#events.delete(key);
    else this.#events.set(key, listeners);
  }

  #rejectAll(error) {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}
