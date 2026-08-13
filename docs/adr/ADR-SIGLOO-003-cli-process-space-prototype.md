# ADR-SIGLOO-003 CLI-first prototype boundary and Process Space evidence

- Status: accepted
- Date: 2026-08-13

## Context

Sigloo needs one canonical interface that can own lifecycle and evidence across browser, process and future
desktop drivers. The first executable surface must be useful for agent workflows without implying that a
temporary directory is equivalent to an OS sandbox.

## Decision

Use `sigloo` as the canonical prototype interface and expose three bounded commands:

- `sigloo doctor` reports driver readiness;
- `sigloo run` executes a command in a new temporary working directory;
- `sigloo browser probe` verifies the accepted BrowserContext isolation primitive.

Process Space evidence records the executable basename and a digest of arguments, not raw arguments or child
output. The child inherits the caller's environment in this prototype. Its temporary directory is removed before
the final receipt is emitted, and any remaining resource makes cleanup fail.

The companion `$sigloo` Skill must call the CLI instead of reimplementing Space lifecycle. It must also preserve
the current capability boundary: Process Space is temporary-working-directory isolation, Browser Space is a
probe rather than a general website runner, and Viewer/takeover remain unimplemented.

## Consequences

Agents get a stable command and evidence contract early, while driver internals can evolve independently.
Repository tests can verify exit propagation, evidence privacy and cleanup without adding runtime dependencies.

This does not provide VM, container, filesystem, network or credential isolation. Stronger Process Space
backends and arbitrary browser-test execution require separate ADRs and evidence.
