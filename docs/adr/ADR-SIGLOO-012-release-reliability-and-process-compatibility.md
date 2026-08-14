# ADR-SIGLOO-012 Release Reliability and Process Compatibility

- Status: accepted
- Date: 2026-08-14

## Context

The MVP must prove repeated isolation, concurrent Spaces, crash recovery and install lifecycle. Dogfooding also
showed that changing a command's cwd to an empty directory breaks unchanged project commands such as
`npm run typecheck`, contradicting ADR-SIGLOO-008.

## Decision

- Launch Chrome through a small watchdog process. It owns Chrome and terminates it when the Sigloo parent pipe
  closes unexpectedly.
- Mark browser temporary profiles with owner PID and uid. `sigloo setup` removes only valid owner-matched profiles
  whose process no longer exists; malformed or active directories fail closed.
- Preserve the caller's cwd for Process runs and provide a separate `SIGLOO_SPACE_DIR` scratch location plus
  isolated artifact paths. Process Space remains explicitly not an OS security sandbox.
- Gate the MVP on 100 full Browser runs, two concurrent isolated Spaces, forced parent termination and recovery,
  install/update/restart/uninstall, full regression, and a real SigTerm existing-command dogfood run.

## Consequences

Chrome does not remain orphaned after a tested parent SIGKILL, and stale temporary profile data is recovered on
the next setup. Existing project commands run unchanged, but Process commands can still modify their project and
access the inherited environment. Strong process isolation requires a future container, sandbox or VM backend.
ADR-SIGLOO-003's temporary-cwd decision is superseded.
