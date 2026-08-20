---
name: sigloo-browser
description: Run browser E2E tests in Sigloo Browser Spaces with isolated BrowserContexts, explicit Auth Profiles, optional Viewer takeover, bounded actions and cleanup evidence. Use for website smoke tests, Playwright-compatible suites, login-state tests and browser isolation checks.
---

# Sigloo Browser

Use the `sigloo` CLI as the canonical interface. Do not attach to the user's existing browser profile.

## Workflow

1. Run `sigloo setup --json` and require recovery resources to be clear.
2. Use a dedicated Auth Profile: `sigloo auth create NAME --origin ORIGIN`, then explicit `sigloo auth login NAME` when credentials must be captured.
3. Run `sigloo browser run --url URL --script PATH --auth-profile PATH --json`.
4. Use `snapshot`, `click`, `fill`, `key`, `screenshot` and named `assert` in the script.
5. Read `SIGLOO_RECEIPT`; require passed status, unchanged Auth Profile and `cleanup.resources_remaining: false`.

## Safety

- Never print or persist cookie, token, password, fill or key values.
- Auth state is explicit and same-origin in v1; ordinary Browser Space changes never merge back.
- Use `--viewer` only when the user requests visibility. Viewer is read-only until explicit takeover.
- Take a fresh snapshot after navigation or DOM changes.

## Example

```bash
sigloo browser run --url https://app.example.test \
  --script ./e2e/browser-smoke.mjs --auth-profile ~/.local/share/sigloo/auth/account.json --json
```
