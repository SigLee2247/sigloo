# ADR-SIGLOO-011 Managed Auth Profile Login

- Status: accepted
- Date: 2026-08-14

## Context

Requiring callers to hand-author a secret JSON path is unsuitable for routine use, while silently importing a
personal browser profile or merging every test mutation would violate Sigloo's authentication boundary.

## Decision

- Store named Auth Profiles under the owner-only Sigloo data root and expose metadata through
  `auth create/list/inspect/select`.
- Persist one selected profile name so `browser run` can omit `--auth-profile`.
- Refresh a profile only through `auth login`: a derived BrowserContext starts from the current profile, the user
  takes control in the loopback Viewer, and `Save login` explicitly authorizes capture.
- Capture only cookies and same-origin localStorage supported by Auth Profile v1, validate size/schema, then
  atomically replace the managed file.
- Keep all ordinary Browser Spaces non-merging.

## Consequences

The common path is CLI-only while authentication remains visible and user-controlled. Secret values live in a
0600 file and are absent from CLI metadata and login results. v1 does not import existing personal browser data,
encrypt profiles at rest, retain sessionStorage, or support cross-origin identity-provider state.
