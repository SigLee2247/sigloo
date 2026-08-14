# EVIDENCE-RUN-001 Evidence

- Date: 2026-08-14
- Decision: ADR-SIGLOO-008
- Result: passed

## Acceptance evidence

| Check | Expected | Result |
| --- | --- | --- |
| Compatibility | existing command follows `sigloo run SPACE -- COMMAND` unchanged | passed in a cross-process CLI E2E |
| Standard paths | child receives log, trace, report and screenshot directories | passed with child-side required-variable assertions |
| Output | stdout and stderr are captured in private files and mirrored | passed; contents and mode `0600` verified |
| Inventory | bounded report lists artifact metadata without contents | passed for logs, trace, report and screenshot |
| Reconnect | later CLI process reads the latest report | passed with `sigloo report SPACE --json` |
| Failure split | command failure is separate from cleanup state | passed with test failure and clean cleanup assertions |
| Regression | Browser isolation, Viewer and lifecycle tests remain green | passed; 15/15 tests and 6-context probe |

## Commands

```text
npm run check         passed
npm test              passed (15/15)
npm run spike:browser passed (6 contexts, no remaining resources)
git diff --check      passed
```

## Boundary

Sigloo does not parse or rewrite framework-specific configuration in this milestone. Invoked tools must be
configured to write optional trace, report and screenshot output to the supplied standard directories. Raw
stdout/stderr artifacts are owner-only and may contain anything the child command prints.
