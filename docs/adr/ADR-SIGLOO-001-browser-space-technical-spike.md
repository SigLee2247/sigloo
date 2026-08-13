# ADR-SIGLOO-001 Browser Space technical spike boundaries

- Status: proposed
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

## Not yet decided

- production implementation language and packaging
- bundled Chromium versus system browser channel
- final encrypted Auth Profile format
- Viewer streaming backend
- macOS desktop isolation backend
