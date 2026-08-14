# BROWSER-RUN-001 Auth Profile E2E evidence

- Date: 2026-08-14
- Platform: macOS arm64
- Browser: Google Chrome 151.0.7922.110
- Runtime dependencies added: none
- Result: passed

## Scenarios

| Scenario | Result |
| --- | --- |
| Derive one cookie into a fresh BrowserContext | pass |
| Derive one localStorage entry into a fresh BrowserContext | pass |
| Execute three named page assertions | pass |
| Capture a valid PNG screenshot | pass |
| Mutate Space cookie and localStorage without changing source profile | pass |
| Exclude all four test secret values from evidence | pass |
| Emit a bounded receipt through the real CLI process | pass |
| Reject an Auth Profile with mode `0644` | pass |
| Fail completion when the source Auth Profile changes during execution | pass |
| Exit Chrome and remove the temporary browser profile | pass |
| Preserve the six-context isolation spike | pass |

`npm test` passed eight tests, including the real `sigloo browser run` CLI path. The focused Browser Space probe
also passed with six contexts and `resources_remaining: false`.

The bundled Skill passed an equivalent Ruby YAML structure check. The upstream Python `quick_validate.py` could
not start because the host Python environment does not provide `PyYAML`; no dependency was installed implicitly.

## Boundaries confirmed

- Auth Profile v1 is explicit, same-origin and owner-only.
- Profile and test contents are represented by digests in evidence.
- Test scripts are trusted local code; BrowserContext isolation is not process or OS isolation.
- Viewer, takeover, browser import, profile encryption and multi-origin execution remain unimplemented.
