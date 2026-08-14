# RELEASE-GATE-001 Evidence

- Date: 2026-08-14
- Decision: ADR-SIGLOO-012
- Result: passed

## Release evidence

| Gate | Expected | Result |
| --- | --- | --- |
| Repetition | 100 full stock-Chrome Browser runs | passed 100/100 with unique Space IDs |
| Cleanup | every run closes Context, Chrome and temporary profile | passed; `resources_remaining: false` |
| Concurrency | two simultaneous Spaces keep mutations separate | passed for `alpha` and `beta` state |
| Crash watchdog | parent SIGKILL leaves no Chrome watchdog | passed; added watchdog processes returned to zero |
| Crash recovery | next setup removes marked orphan profile | passed; one profile recovered |
| Install lifecycle | install, identical update, fresh execution and uninstall | passed; retained release remained readable |
| Existing command | SigTerm command runs unchanged from its project cwd | passed for `npm run typecheck` |
| Dogfood cleanup | SigTerm receipt reports no remaining resources | passed; Space scratch removed |

## Receipts

```json
{
  "status": "passed",
  "browser_runs": 100,
  "concurrent_spaces": 2,
  "crash_recovery": {
    "watchdog_processes_remaining": 0,
    "temporary_profiles_recovered": 1
  },
  "install_lifecycle": "passed",
  "resources_remaining": false
}
```

SigTerm dogfood Space: `sigterm-typecheck-20260814025431818-9f95a1d7`, status `passed`, command
`npm run typecheck`, cleanup `resources_remaining: false`.

## Boundary

The 100-run gate used local loopback content and stock installed Chrome. It does not claim cross-origin login,
desktop/Electron driver support, remote CI distribution, package publication or OS-level Process isolation.
