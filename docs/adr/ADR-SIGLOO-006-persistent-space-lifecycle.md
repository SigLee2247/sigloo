# ADR-SIGLOO-006 Persistent Space Lifecycle

- Status: accepted
- Date: 2026-08-14

## Context

The prototype runs each command in one synchronous CLI process. The approved product contract requires a stable
Space identity, ownership, TTL and reconnect after that process exits. This state must exist above individual
drivers so Browser, Process and later Application drivers share one lifecycle.

## Decision

Add a local owner-scoped Space registry and the commands `create`, `list`, `inspect`, `complete` and `destroy`.

- Records and Space directories are owner-only under the Sigloo data root.
- A Space has a stable UUID-derived ID, name, logical owner, creation time and bounded TTL from 1 second to 7 days.
- `run SPACE -- COMMAND` reuses the persistent working and evidence directories across CLI processes.
- `SIGLOO_OWNER_ID` identifies a logical caller; a mismatch returns a distinct machine-readable error and exit 3.
- Expired Spaces are lazily reaped by later CLI operations and receive a cleanup receipt.
- Destroy and expiry remove Space resources but retain bounded metadata and cleanup evidence.
- The existing unnamed `run --name ... -- COMMAND` remains an ephemeral compatibility path.

## Consequences

CLI exit no longer implies Space destruction, and another process can reconnect by name or ID during TTL. This
logical owner boundary prevents accidental cross-agent control but is not an OS security boundary because callers
under the same account can choose the environment identifier. Continuous crash recovery still requires the later
Supervisor milestone; lazy TTL reaping is the deterministic fallback in this milestone.
