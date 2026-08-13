# SPIKE-001 Browser Space evidence

- Date: 2026-08-13
- Platform: macOS arm64
- Node.js: 20.20.2
- Browser: Google Chrome 151.0.7922.110
- Transport: Chrome DevTools Protocol over `--remote-debugging-pipe`
- External dependencies: none
- Result: passed

## Question

Can stock Chromium create several task-local BrowserContexts from the same explicit Auth Profile starting state,
keep runtime cookie and localStorage mutations isolated, and clean up the browser process and temporary profile?

## Method

1. Launch one headless Chrome process with a temporary `user-data-dir`.
2. Create six BrowserContexts through CDP.
3. Inject the same `sigloo_session` cookie and `sigloo_auth` localStorage value into every context.
4. Mutate both values in the first context.
5. Read the values from every remaining context and the immutable in-memory Auth Profile.
6. Dispose every BrowserContext, close Chrome and remove the temporary profile.

## Observed result

| Check | Result |
| --- | --- |
| Six contexts received the same starting cookie | pass |
| Six contexts received the same starting localStorage | pass |
| First context cookie mutation stayed local | pass |
| First context localStorage mutation stayed local | pass |
| Source Auth Profile remained unchanged | pass |
| Chrome process exited | pass |
| Temporary profile was removed | pass |
| Resources remaining | false |

Focused test duration was approximately two seconds on the tested host. `npm test`, `npm run check` and the
standalone `npm run spike:browser` command passed.

## Interpretation

Stock Chromium provides enough primitives for the first Browser Space prototype without a Chromium fork or a
runtime dependency on another browser product. This spike proves explicit cookie and localStorage starting-state
derivation, not complete browser-profile cloning.

## Remaining uncertainty

- IndexedDB, service workers, Cache Storage and extension state
- SSO flows using OS or browser-bound credentials
- encrypted persistent Auth Profile format and Keychain integration
- headed Viewer and takeover without focus theft
- parallel load, crash recovery and 100-run orphan-process gate
- differences across Chromium versions and non-Chromium browsers
