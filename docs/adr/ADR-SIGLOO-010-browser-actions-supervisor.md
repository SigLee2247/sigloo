# ADR-SIGLOO-010 Browser Actions and Resource Supervisor

- Status: accepted
- Date: 2026-08-14

## Context

Arbitrary JavaScript evaluation is useful for assertions but is a poor canonical interaction surface for Agents.
Browser runs also need one cleanup authority so a failure in one resource does not prevent later resources from
closing.

## Decision

- `snapshot()` returns at most 500 visible interactive elements with Space-local `eN` references, roles, bounded
  accessible names and disabled state. It never returns input values.
- `click`, `fill` and `key` accept references from the latest snapshot. Unknown or stale references fail closed.
- Action evidence contains only action name, target reference, status, timestamp and snapshot element count. Fill
  text and key values are never recorded.
- A per-run Supervisor owns Viewer, BrowserContext, Chrome process and temporary profile cleanup. It closes in
  reverse registration order, continues after individual failures and emits a bounded cleanup receipt.

## Consequences

Agents receive a smaller, deterministic interaction surface while trusted local test modules retain `evaluate`
for assertions and exceptional cases. DOM changes may invalidate references, so callers must snapshot again.
The in-process Supervisor improves deterministic cleanup; host-process crash recovery remains a separate gate.
