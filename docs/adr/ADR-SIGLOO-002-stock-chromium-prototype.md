# ADR-SIGLOO-002 Stock Chromium for the Browser Space prototype

- Status: accepted
- Date: 2026-08-13

## Context

Sigloo needs a Browser Space runtime that can isolate concurrent E2E tasks, derive an authenticated starting
state and clean up without changing the user's active browser. A custom Chromium build could eventually provide
deeper integration, but it would add an expensive distribution and maintenance boundary before the required
primitives are understood.

SPIKE-001 demonstrated six isolated BrowserContexts in one stock Chrome process using CDP over pipe. Every
context received the same explicit cookie and localStorage state. A mutation in one context did not affect the
others or the immutable source Auth Profile, and cleanup left no temporary profile behind.

Read-only observation of ego-lite 0.4.6.13 also showed a useful separation of concerns: a Chromium-derived app,
a native CLI helper and a task-space lifecycle surface. This observation informs the problem decomposition only;
Sigloo's runtime and contracts remain independent.

## Decision

Use stock Chromium and CDP as the Browser Space prototype base.

- Sigloo owns Space identity, ownership, TTL, state derivation, evidence and cleanup.
- Auth Profile input is explicit and immutable for the lifetime of a Space.
- Every task receives a distinct BrowserContext; runtime state is not merged back automatically.
- Browser automation libraries such as Playwright are adapters, not the owner of Space lifecycle.
- The default execution path remains headless. A headed Viewer is a separate, optional observation surface.
- A bundled or custom Chromium distribution remains an open production decision.

## Consequences

The prototype can advance without maintaining a browser fork or depending on another browser product. The next
gate must extend isolation coverage to IndexedDB, service workers and Cache Storage, then test headed observation,
takeover, crash recovery and repeated cleanup.

Stock BrowserContexts do not by themselves provide full profile cloning, extension-state inheritance, OS-bound
credential reuse or desktop application isolation. Those capabilities require separate designs and evidence.
