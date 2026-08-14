# ADR-SIGLOO-005 Read-only Browser Viewer

- Status: accepted
- Date: 2026-08-14

## Context

Headless Browser Spaces avoid focus and input interference, but users sometimes need to observe an E2E run. A
headed browser would compete for the user's desktop, while a control-capable viewer would introduce ownership and
input-routing decisions that are not yet implemented.

## Decision

Add an optional `--viewer` to `sigloo browser run`.

- Chromium remains headless and connected through the existing CDP pipe.
- Sigloo binds an ephemeral HTTP server to `127.0.0.1` with a random capability path.
- The Viewer serves only its HTML shell and current PNG frames with `GET` or `HEAD`.
- Mutation methods return `405`; no click, keyboard, form or takeover route exists.
- Security headers disable caching, framing, referrers and unlisted content sources.
- `SIGLOO_VIEWER` announces the temporary URL, mode and current control owner.
- Evidence records mode, request counts and cleanup, but never the URL or capability token.
- The server closes before Browser Space cleanup can pass. A remaining Viewer fails the run invariant.

## Consequences

Users can watch a Browser Space without moving the agent into their normal browser or giving the Viewer control.
The page is a polled screenshot stream rather than an interactive browser surface, so it may lag by one polling
interval. Remote viewing, streaming codecs, multiple observers, input ownership and takeover remain later decisions.
