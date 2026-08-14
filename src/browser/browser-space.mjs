export class BrowserSpace {
  constructor(cdp, browserContextId, targetId, sessionId, origin) {
    this.cdp = cdp;
    this.browserContextId = browserContextId;
    this.targetId = targetId;
    this.sessionId = sessionId;
    this.origin = origin;
  }

  static async create(cdp, initialUrl, authProfile) {
    const origin = new URL(initialUrl).origin;
    const { browserContextId } = await cdp.send('Target.createBrowserContext', {
      disposeOnDetach: false,
    });
    const { targetId } = await cdp.send('Target.createTarget', {
      url: 'about:blank', browserContextId, background: true,
    });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const space = new BrowserSpace(cdp, browserContextId, targetId, sessionId, origin);
    await cdp.send('Page.enable', {}, sessionId);
    await space.goto(initialUrl);
    await space.applyAuthProfile(authProfile);
    await space.goto(initialUrl);
    return space;
  }

  async applyAuthProfile(authProfile) {
    if (authProfile.origin !== this.origin) {
      throw new Error('Auth Profile origin does not match the initial URL origin');
    }
    const cookies = authProfile.cookies.map((cookie) => ({ ...cookie, url: this.origin }));
    await this.cdp.send('Storage.setCookies', { browserContextId: this.browserContextId, cookies });
    await this.evaluate('localStorage.clear()');
    for (const [key, value] of Object.entries(authProfile.local_storage)) {
      await this.evaluate(`localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)})`);
    }
  }

  async goto(url) {
    const targetOrigin = new URL(url).origin;
    if (targetOrigin !== this.origin) throw new Error('Cross-origin navigation is not enabled in this prototype');
    const loaded = this.cdp.waitFor('Page.loadEventFired', this.sessionId);
    await this.cdp.send('Page.navigate', { url }, this.sessionId);
    await loaded;
  }

  async setCookie(name, value) {
    await this.cdp.send('Storage.setCookies', {
      browserContextId: this.browserContextId,
      cookies: [{ name, value, url: this.origin }],
    });
  }

  async getCookie(name) {
    const { cookies } = await this.cdp.send('Storage.getCookies', {
      browserContextId: this.browserContextId,
    });
    return cookies.find((cookie) => cookie.name === name)?.value ?? null;
  }

  async setLocalStorage(name, value) {
    await this.evaluate(`localStorage.setItem(${JSON.stringify(name)}, ${JSON.stringify(value)})`);
  }

  async getLocalStorage(name) {
    return this.evaluate(`localStorage.getItem(${JSON.stringify(name)})`);
  }

  async evaluate(expression) {
    if (typeof expression !== 'string' || expression.length === 0) {
      throw new Error('Browser evaluation requires a non-empty string');
    }
    const { result, exceptionDetails } = await this.cdp.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    }, this.sessionId);
    if (exceptionDetails) throw new Error('Browser evaluation failed');
    return result.value;
  }

  async captureScreenshot() {
    const { data } = await this.cdp.send('Page.captureScreenshot', { format: 'png' }, this.sessionId);
    return Buffer.from(data, 'base64');
  }

  async dispose() {
    await this.cdp.send('Target.disposeBrowserContext', { browserContextId: this.browserContextId });
  }
}
