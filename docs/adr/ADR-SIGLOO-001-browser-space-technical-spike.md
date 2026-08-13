# ADR-SIGLOO-001 Browser Space technical spike boundaries

- Status: accepted
- Date: 2026-08-13

## Context

Sigloo needs isolated Browser Spaces that can derive a reusable authenticated starting state without sharing
runtime cookie and storage mutations between concurrent tasks.

## Spike decision

Before selecting a browser fork or external framework, validate what stock Chromium exposes through CDP:

1. multiple BrowserContexts in one browser process;
2. independent cookie and storage mutation;
3. explicit starting-state injection;
4. no automatic merge back to the source Auth Profile;
5. deterministic process and temporary-profile cleanup.

The spike may inspect public source, documented protocols and installed product behavior. Findings must identify
the tested version, observed fact, inference and remaining uncertainty.

## Outcome

SPIKE-001 passed on Chrome 151.0.7922.110. Six CDP BrowserContexts derived the same explicit cookie and
localStorage starting state, while mutations in one context remained isolated and the source Auth Profile stayed
unchanged. The browser process and temporary profile were removed deterministically.

The result is sufficient to accept stock Chromium as the Browser Space prototype base. It does not establish
complete browser-profile cloning or settle the production browser distribution strategy. Those boundaries are
recorded in ADR-SIGLOO-002.

## Not yet decided

- production implementation language and packaging
- bundled Chromium versus system browser channel
- final encrypted Auth Profile format
- Viewer streaming backend
- macOS desktop isolation backend
