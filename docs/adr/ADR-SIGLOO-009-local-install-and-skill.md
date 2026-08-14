# ADR-SIGLOO-009 Local Install and Companion Skill

- Status: accepted
- Date: 2026-08-14

## Context

Sigloo must be usable outside its source checkout through a short `sigloo` command. Agent hosts also need a
versioned workflow contract without making MCP the product interface. A local update must not partially replace
the executable or overwrite a launcher owned by another tool.

## Decision

- Install immutable, content-addressed releases under `~/.local/share/sigloo/releases`.
- Atomically point `~/.local/bin/sigloo` at the selected release and only replace links owned by that install root.
- Make repeated installation an idempotent update and retain releases and runtime data during launcher uninstall.
- Initialize owner-only runtime state with `sigloo setup`.
- Install the repository-owned `$sigloo` companion workflow with `sigloo agent install codex` while refusing to
  replace a non-Sigloo Skill.
- Keep the CLI as the canonical product interface; the Skill invokes it and is not a second runtime protocol.

## Consequences

An installed CLI can be started from a fresh process without the checkout. Interrupted copies cannot become the
active release because staging is renamed before the launcher is switched. Disk cleanup of retained releases is
deferred until a bounded garbage-collection policy exists. Codex must begin a new session to refresh Skill
discovery after installation.
