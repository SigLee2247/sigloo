# Sigloo

Sigloo is a local-first, CLI-first E2E Space Runtime for AI agents and developers.

It creates isolated spaces for browser, process, application and future desktop testing while keeping lifecycle,
ownership, observation, evidence and cleanup consistent across drivers.

## Product direction

- Command: `sigloo`
- Companion Skill: `$sigloo`
- Initial platform: macOS
- Initial surfaces: browser, shell and Electron
- Browser authentication: dedicated Auth Profiles with per-Space derived state
- Viewer: optional and read-only by default
- MCP: not part of the initial canonical interface

The repository is in its technical-spike phase. No production CLI is published yet.

## Prototype CLI

Run the local CLI directly from the repository:

```bash
node bin/sigloo.mjs doctor --json
node bin/sigloo.mjs run --name smoke -- node /absolute/path/to/smoke-test.mjs
node bin/sigloo.mjs browser run --url https://app.example.test --script ./e2e.mjs --auth-profile ./auth.json
node bin/sigloo.mjs browser run --url https://app.example.test --script ./e2e.mjs --auth-profile ./auth.json --viewer
node bin/sigloo.mjs browser probe --json
```

`sigloo run` currently isolates the child command with a temporary working directory and emits a cleanup receipt
plus a private evidence file under `.sigloo/evidence`. It is not an OS security sandbox. `browser probe` verifies
the BrowserContext isolation primitive independently from a test script.

`browser run` executes a trusted local JavaScript test in a fresh, headless BrowserContext. Its explicit Auth
Profile is owner-only and remains unchanged. See `docs/reference/AUTH-PROFILE.md` for the v1 format and current
same-origin boundary. `--viewer` prints a temporary loopback URL that shows the current frame without adding
click, keyboard or form-control routes. It closes with the run and does not provide takeover.
