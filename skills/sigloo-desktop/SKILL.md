---
name: sigloo-desktop
description: Test Electron applications in Sigloo's offscreen Desktop Space without putting windows or input on the user's screen. Trigger for 'Electron 앱 테스트해줘', 'SigTerm 테스트해줘', '화면에 띄우지 말고 앱 검사', '데스크톱 앱 E2E', 'renderer/IPC 확인', 'terminal 입력 테스트', or Electron desktop smoke and crash-recovery requests.
---

# Sigloo Desktop

Natural-language triggers: “Electron 앱 테스트”, “SigTerm dogfood”, “창을 띄우지 않고 테스트”, “renderer 검사”, “IPC 테스트”, “터미널 입력 검증”, “desktop smoke test”.

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
