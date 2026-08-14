# VIEWER-001 Browser Viewer Evidence

- Date: 2026-08-14
- Decision: ADR-SIGLOO-005
- Platform: macOS arm64
- Browser: Google Chrome 151.0.7922.110
- Runtime dependencies added: none
- Result: passed

## Acceptance evidence

| Check | Expected | Result |
| --- | --- | --- |
| Network binding | loopback ephemeral URL | pass: `127.0.0.1` + random port + 48-hex capability path |
| Viewer control | GET/HEAD frames only; mutation rejected | pass: PNG frame returned, POST returned `405` |
| Browser behavior | headless Browser Space remains canonical | pass: CDP pipe and headless Chrome retained |
| Sensitive evidence | no Viewer URL or capability token | pass: evidence serialization assertion |
| Cleanup | Viewer, Chromium and temporary profile closed | pass: all cleanup fields true, no resources remaining |
| Regression | full Node test suite and BrowserContext probe pass | pass: 9/9 tests and 6 contexts |

`npm run check`, `npm test`, `npm run spike:browser` and `git diff --check` passed. The real Chrome E2E
loaded the Viewer shell and PNG frame, rejected a mutation request, ran three named assertions, preserved the
source Auth Profile and closed the Viewer before emitting its receipt.

## Reusable knowledge candidate

The read-only observation boundary may become a reference page when remote transport or takeover is designed.
