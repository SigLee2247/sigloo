# AUTH-PROFILE-001 Evidence

- Date: 2026-08-14
- Decision: ADR-SIGLOO-011
- Result: passed

## Acceptance evidence

| Check | Expected | Result |
| --- | --- | --- |
| Create | named empty profile is owner-only | passed; file has no group/other mode bits |
| Discovery | list and inspect expose metadata, not state values | passed across CLI processes |
| Select | selected name supplies later Browser runs | passed without `--auth-profile` |
| Login control | save is rejected until explicit user takeover | passed with 409 before takeover |
| Login capture | explicit save persists cookie and localStorage | passed in stock Chrome |
| Redaction | login result omits cookie and storage values | passed with negative assertions |
| Isolation | selected Browser run derives saved state | passed with named assertion and clean receipt |

## Commands

```text
npm run check                                                   passed
node --test test/auth-profile-store.test.mjs test/browser-run.test.mjs passed (5/5)
```

## Boundary

The automated E2E triggers the same loopback takeover and save endpoints as the rendered Viewer. Production use
requires a human to perform those visible actions. Cross-origin identity-provider capture remains outside v1.
