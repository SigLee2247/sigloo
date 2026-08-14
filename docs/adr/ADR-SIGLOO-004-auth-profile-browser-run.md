# ADR-SIGLOO-004 Explicit Auth Profile Browser Run

- Status: accepted
- Date: 2026-08-14

## Context

The Browser Space spike proved state isolation but did not provide a reusable E2E command. Browser execution now
needs an explicit authentication input, a small test API, bounded evidence and deterministic cleanup without
reading the user's active browser profile.

## Decision

Add `sigloo browser run` with required `--url`, `--script` and `--auth-profile` inputs.

- Auth Profile v1 is a regular owner-only JSON file bound to one canonical origin.
- A run derives cookies and localStorage into a new Chromium BrowserContext.
- Navigation is same-origin in this milestone.
- The test module is trusted local code and receives a bounded page API.
- Evidence stores profile and script digests, entry counts, named checks, artifacts and cleanup status.
- Evidence never stores cookie values, localStorage values, raw script results or raw failure messages.
- Space mutations never merge back. The source profile digest must be unchanged at completion.
- Execution remains headless. Viewer and takeover are a separate milestone.

## Consequences

Agents can run real authenticated browser E2E without competing with the user's normal browser. A profile can be
prepared independently and reused as an immutable starting point for multiple Spaces.

Profile encryption, refresh, browser import, multiple origins, extension state, Playwright adapters and hostile
test-code containment remain unresolved. The JavaScript test module has the caller's local process authority;
only its browser state is isolated by this command.
