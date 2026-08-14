# ADR-SIGLOO-007 Explicit Viewer Takeover

- Status: accepted
- Date: 2026-08-14

## Context

The read-only Viewer lets a person observe a Browser Space without competing with the agent. Some E2E flows
still require a person to handle an ambiguous UI, confirmation step or manual input. Allowing both parties to
send input concurrently would make the run nondeterministic and unsafe.

## Decision

Keep the Viewer read-only by default and add an explicit, exclusive user-control state.

- The loopback Viewer shows a `Take control` action and a distinct user-control indicator.
- Only the unguessable Viewer-token routes may request takeover, return or bounded pointer/key input.
- Browser actions requested by the test API wait while the user owns control and resume only after explicit return.
- Closing the Viewer during user control interrupts waiting agent work instead of silently resuming it.
- Input is translated to constrained CDP pointer and key events; arbitrary JavaScript and navigation are not input routes.
- The final report records counts and final ownership but never the Viewer URL, route token or entered values.

## Consequences

Human and agent input are mutually exclusive within the Browser Space, and the default observation behavior is
unchanged. This is a local coordination boundary, not authentication against another process running as the same
OS user. Rich text composition, drag, scroll and accessibility actions remain future input types.
