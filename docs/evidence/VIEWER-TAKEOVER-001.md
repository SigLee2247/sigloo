# VIEWER-TAKEOVER-001 Evidence

- Date: 2026-08-14
- Decision: ADR-SIGLOO-007
- Result: passed

## Acceptance evidence

| Check | Expected | Result |
| --- | --- | --- |
| Default | Viewer starts with agent control and observation only | passed; page labels the initial state read-only |
| Takeover | explicit takeover changes the sole control owner to user | passed through the rendered Viewer page in stock Chrome |
| Agent gate | browser API work waits until explicit return | passed with a pending/resume assertion |
| User input | bounded Viewer pointer/key input reaches the isolated page | passed; the Browser Run page received `human42` |
| Forced close | waiting work is interrupted rather than resumed | passed with a rejected-wait assertion |
| Evidence | report omits URL token and input values | passed with negative evidence assertions |
| Cleanup | Viewer and browser close with no remaining resources | passed in the full Browser Run E2E |

## Commands

```text
npm run check         passed
npm test              passed (15/15)
npm run spike:browser passed (6 contexts, no remaining resources)
git diff --check      passed
```

## Boundary

The route token and loopback binding coordinate trusted local participants. They do not form an OS security
boundary against another process running as the same account.
