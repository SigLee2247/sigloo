# Auth Profile v1

An Auth Profile is an explicit, owner-readable JSON input used to derive the starting state of one Browser
Space. Sigloo reads it but never merges Space mutations back into it.

The file must be a regular file with mode `0600`, must not exceed 1 MiB and has this shape:

```json
{
  "schema_version": 1,
  "origin": "https://app.example.test",
  "cookies": [
    {
      "name": "session",
      "value": "replace-with-a-private-value",
      "path": "/",
      "secure": true,
      "httpOnly": true,
      "sameSite": "Lax"
    }
  ],
  "local_storage": {
    "session-state": "replace-with-a-private-value"
  }
}
```

The origin and initial `--url` must use HTTP(S), and the initial URL must have exactly the same origin. Embedded
URL credentials are rejected. Cross-origin navigation, existing-browser import,
encrypted profile storage and profile refresh are not part of v1.

Never commit a real Auth Profile. Evidence contains only its SHA-256 digest and entry counts, not cookie or
localStorage values.

## Browser test module

Pass an absolute or invocation-directory-relative ECMAScript module of at most 1 MiB to `--script`. It must
export one default async function:

```js
export default async function (page) {
  page.assert('account-visible', await page.evaluate(
    "document.querySelector('[data-test=account]') !== null",
  ));
  await page.screenshot('account');
}
```

The API provides `goto`, `evaluate`, cookie and localStorage getters/setters, named `assert` and `screenshot`.
Navigation is limited to the Auth Profile origin. The script runs as trusted local code in the Sigloo process;
BrowserContext isolation is not an OS security sandbox.
