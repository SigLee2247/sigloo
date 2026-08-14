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

The CLI is currently installed from a local checkout. No package is published yet.

## Local install

Install a content-addressed release and the `sigloo` launcher, then initialize its private data root and companion
Codex Skill:

```bash
node scripts/install-local.mjs install
sigloo setup --json
sigloo agent install codex --json
```

The defaults are `~/.local/share/sigloo` for releases and runtime data, `~/.local/bin/sigloo` for the launcher,
and `~/.codex/skills/sigloo/SKILL.md` for `$sigloo`. Add `~/.local/bin` to `PATH` if needed, and start a new Codex
session after installing the Skill so discovery is refreshed. Re-running `install` is an atomic, idempotent update.
The installer refuses to replace launchers it does not own.

To remove only the launcher while retaining releases and user data:

```bash
node scripts/install-local.mjs uninstall
```

## CLI

Run the local CLI directly from the repository:

```bash
node bin/sigloo.mjs doctor --json
node bin/sigloo.mjs create checkout --ttl 30m --json
node bin/sigloo.mjs run checkout -- node /absolute/path/to/smoke-test.mjs
node bin/sigloo.mjs inspect checkout --json
node bin/sigloo.mjs report checkout --json
node bin/sigloo.mjs destroy checkout --json
node bin/sigloo.mjs run --name smoke -- node /absolute/path/to/smoke-test.mjs
node bin/sigloo.mjs browser run --url https://app.example.test --script ./e2e.mjs --auth-profile ./auth.json
node bin/sigloo.mjs browser run --url https://app.example.test --script ./e2e.mjs --auth-profile ./auth.json --viewer
node bin/sigloo.mjs browser probe --json
```

`sigloo run` currently isolates the child command with a temporary working directory and emits a cleanup receipt
plus a private evidence file under `.sigloo/evidence`. It is not an OS security sandbox. `browser probe` verifies
the BrowserContext isolation primitive independently from a test script.

`sigloo create` makes a named Space with a stable ID and bounded TTL. A later CLI process can `inspect` or
`run` it by name or ID. Persistent Space metadata defaults to `~/.local/share/sigloo`; tests and managed installs
can override it with `SIGLOO_DATA_ROOT`. Ownership is a logical local boundary keyed by `SIGLOO_OWNER_ID` (or the
current uid by default), not an OS security boundary. `destroy` and TTL expiry remove the Space directory and
record cleanup separately from the test result.

`sigloo run <space> -- <existing command>` does not introduce a test DSL. Existing Playwright and shell suites
keep their original command. The child receives `SIGLOO_LOG_DIR`, `SIGLOO_TRACE_DIR`, `SIGLOO_REPORT_DIR`,
`SIGLOO_SCREENSHOT_DIR` and `SIGLOO_ARTIFACT_DIR`; configure the existing tool to write optional outputs there.
Sigloo always captures stdout/stderr privately and inventories artifact paths and byte counts in the bounded
report. Use `sigloo report <space>` from a later CLI process while the Space evidence still exists.

`browser run` executes a trusted local JavaScript test in a fresh, headless BrowserContext. Its explicit Auth
Profile is owner-only and remains unchanged. See `docs/reference/AUTH-PROFILE.md` for the v1 format and current
same-origin boundary. `--viewer` prints a temporary loopback URL. It begins read-only; `Take control` pauses
agent browser actions and enables bounded pointer/key input until `Return to agent` is selected. Closing during
takeover interrupts waiting agent work. The Viewer closes with the run, and its token and input values are never
written to evidence.

Browser test modules can use `snapshot()` to receive bounded, Space-local element references, then call
`click(ref)`, `fill(ref, text)` or `key(ref, key)`. Fill text and key values are excluded from action evidence.
Every browser resource is registered with the run Supervisor and closed in reverse dependency order; cleanup
reports both individual resource results and the final `resources_remaining` invariant.
