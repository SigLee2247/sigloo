export class BrowserSpace {
  constructor(cdp, browserContextId, targetId, sessionId, origin) {
    this.cdp = cdp;
    this.browserContextId = browserContextId;
    this.targetId = targetId;
    this.sessionId = sessionId;
    this.origin = origin;
    this.elementReferences = new Map();
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

  async captureAuthProfile() {
    const { cookies } = await this.cdp.send('Storage.getCookies', {
      browserContextId: this.browserContextId,
    });
    const localStorage = await this.evaluate('Object.fromEntries(Object.entries(localStorage))');
    return {
      schema_version: 1,
      origin: this.origin,
      cookies: cookies.slice(0, 1_000).map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        path: cookie.path || '/',
        secure: Boolean(cookie.secure),
        httpOnly: Boolean(cookie.httpOnly),
        sameSite: ['Strict', 'Lax', 'None'].includes(cookie.sameSite) ? cookie.sameSite : 'Lax',
      })),
      local_storage: Object.fromEntries(Object.entries(localStorage).slice(0, 1_000)),
    };
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

  async snapshot() {
    const elements = await this.evaluate(`(() => {
      const selectorFor = (element) => {
        if (element.id) return '#' + CSS.escape(element.id);
        const parts = [];
        for (let current = element; current && current.nodeType === Node.ELEMENT_NODE; current = current.parentElement) {
          const tag = current.tagName.toLowerCase();
          const siblings = current.parentElement
            ? [...current.parentElement.children].filter((item) => item.tagName === current.tagName)
            : [];
          parts.unshift(siblings.length > 1 ? tag + ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')' : tag);
          if (current === document.body) break;
        }
        return parts.join(' > ');
      };
      const roleFor = (element) => element.getAttribute('role') || ({
        A: 'link', BUTTON: 'button', INPUT: element.type === 'checkbox' ? 'checkbox' : 'textbox',
        TEXTAREA: 'textbox', SELECT: 'combobox'
      })[element.tagName] || 'element';
      return [...document.querySelectorAll('a,button,input,textarea,select,[role],[contenteditable="true"]')]
        .filter((element) => element.getClientRects().length > 0)
        .slice(0, 500)
        .map((element) => ({
          selector: selectorFor(element),
          role: roleFor(element),
          name: String(element.getAttribute('aria-label') || element.getAttribute('placeholder') ||
            element.getAttribute('alt') || ((element.tagName === 'BUTTON' || element.tagName === 'A') ? element.textContent : '') || '')
            .replace(/\\s+/g, ' ').trim().slice(0, 120),
          disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true')
        }));
    })()`);
    this.elementReferences.clear();
    return {
      url: await this.evaluate('location.href'),
      title: String(await this.evaluate('document.title')).slice(0, 200),
      elements: elements.map((element, index) => {
        const ref = `e${index + 1}`;
        this.elementReferences.set(ref, element.selector);
        return { ref, role: element.role, name: element.name, disabled: element.disabled };
      }),
      truncated: elements.length === 500,
    };
  }

  resolveElementReference(ref) {
    if (typeof ref !== 'string' || !/^e[1-9][0-9]{0,3}$/.test(ref)) throw new Error('Element reference is invalid');
    const selector = this.elementReferences.get(ref);
    if (!selector) throw new Error('Element reference is stale; take a new snapshot');
    return selector;
  }

  async click(ref) {
    const selector = this.resolveElementReference(ref);
    const clicked = await this.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element || element.disabled || element.getAttribute('aria-disabled') === 'true') return false;
      element.click();
      return true;
    })()`);
    if (!clicked) throw new Error('Element is missing or disabled');
  }

  async fill(ref, value) {
    if (typeof value !== 'string' || value.length > 65_536) throw new Error('Fill value must be a string of at most 65536 characters');
    const selector = this.resolveElementReference(ref);
    const filled = await this.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element || element.disabled || element.readOnly || !('value' in element)) return false;
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(element, ${JSON.stringify(value)}); else element.value = ${JSON.stringify(value)};
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.focus();
      return true;
    })()`);
    if (!filled) throw new Error('Element cannot be filled');
  }

  async key(ref, key) {
    if (typeof key !== 'string' || key.length === 0 || key.length > 32) throw new Error('Key must be 1-32 characters');
    const selector = this.resolveElementReference(ref);
    const focused = await this.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element || element.disabled) return false;
      element.focus();
      return document.activeElement === element;
    })()`);
    if (!focused) throw new Error('Element cannot receive keyboard input');
    if ([...key].length === 1) {
      await this.cdp.send('Input.insertText', { text: key }, this.sessionId);
      return;
    }
    const special = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46 }[key];
    if (!special) throw new Error('Unsupported named key');
    await this.cdp.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: special,
    }, this.sessionId);
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: special }, this.sessionId);
  }

  async captureScreenshot() {
    const { data } = await this.cdp.send('Page.captureScreenshot', { format: 'png' }, this.sessionId);
    return Buffer.from(data, 'base64');
  }

  async dispatchInput(event) {
    if (!event || typeof event !== 'object') throw new Error('Viewer input must be an object');
    if (event.type === 'pointer') {
      const { x, y, button } = event;
      if (![x, y].every((value) => Number.isFinite(value) && value >= 0 && value <= 10_000) || button !== 'left') {
        throw new Error('Viewer pointer input is invalid');
      }
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1 }, this.sessionId);
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1 }, this.sessionId);
      return;
    }
    if (event.type === 'key') {
      const { key } = event;
      if (typeof key !== 'string' || key.length === 0 || key.length > 32) throw new Error('Viewer key input is invalid');
      const text = [...key].length === 1 ? key : undefined;
      await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, text }, this.sessionId);
      await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key }, this.sessionId);
      return;
    }
    throw new Error('Viewer input type is not supported');
  }

  async dispose() {
    await this.cdp.send('Target.disposeBrowserContext', { browserContextId: this.browserContextId });
  }
}
