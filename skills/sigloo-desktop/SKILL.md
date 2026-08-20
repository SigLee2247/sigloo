---
name: sigloo-desktop
description: Test Electron applications in Sigloo's offscreen Desktop Space without putting windows or input on the user's screen. Use for renderer DOM checks, terminal/PTY smoke tests, IPC checks, screenshots, multi-window flows, crash recovery and deterministic cleanup.
---

# Sigloo Desktop

Desktop Space launches Electron with isolated `userData`, offscreen rendering, a bounded DevTools connection and private evidence. It is experimental and requires an app that honors `SIGLOO_DESKTOP_MODE=offscreen` for true window suppression.

## Workflow

1. Build the Electron app and identify its Electron executable and app directory.
2. Run `sigloo setup --json` before the first Space.
3. Use `sigloo desktop run --app APP --electron-path ELECTRON --script SCRIPT --json`.
4. In the script select a target with `windows()` and `useWindow(id)`.
5. Use `evaluate`, `click`, `fill`, `type`, `key`, `keyChord`, `clickAt`, `drag`, `reload`, `screenshot` and `close`.
6. For terminal apps, wait for the app-specific input selector before typing and assert output.
7. Require passed status and `cleanup.resources_remaining: false`.

## Isolation rules

- Never use visible mode for unattended tests.
- Desktop children get a temporary `userData`; cache/download data must remain inside it.
- Sensitive environment variables are redacted unless `SIGLOO_ALLOW_SENSITIVE_ENV=1` is explicitly required.
- Offscreen app integrations must not use the host clipboard or native dialogs; prefer Space-local adapters.
- A script failure terminates the app promptly; timeout escalates from SIGTERM to SIGKILL.

## Example

```bash
sigloo desktop run --app /path/to/app \
  --electron-path /path/to/Electron \
  --script ./e2e/desktop-smoke.mjs --json
```
