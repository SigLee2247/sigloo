---
name: sigloo
description: Run and verify E2E work in Sigloo's isolated CLI Spaces. Use when an agent needs to execute tests or commands away from the user's active environment, inspect Sigloo driver readiness, verify Browser Space isolation, collect evidence, or confirm deterministic cleanup with the `sigloo` CLI.
---

# Sigloo

Use `sigloo` as the canonical interface. Do not replace its Space lifecycle with direct Playwright, CUA or shell
execution when Sigloo supports the requested surface.

## Workflow

1. Run `sigloo doctor --json` and inspect the requested driver's status.
2. Select the narrowest available driver command.
3. Run the task with a short, goal-specific Space name.
4. Read the final `SIGLOO_RECEIPT` or JSON report.
5. Treat `cleanup.resources_remaining: true` as a failed run and report it.

## Process Space

Run a command in a temporary working directory:

```bash
sigloo run --name checkout-e2e -- node /absolute/path/to/smoke-test.mjs
```

The command inherits the current environment but receives a new working directory and `SIGLOO_SPACE_ID`,
`SIGLOO_SPACE_DIR` and `SIGLOO_SPACE_DRIVER`. The prototype does not provide an OS sandbox. Preserve this
distinction in user-facing claims.

Use `--evidence-dir PATH` only when evidence must live outside the default `.sigloo/evidence` directory. Do not
put passwords, tokens or credential values in the Space name or command arguments.

## Browser Space

Run an approved local browser test with an explicit Auth Profile:

```bash
sigloo browser run --name account-e2e --url https://app.example.test \
  --script /absolute/path/to/e2e.mjs --auth-profile /private/path/auth-profile.json
```

Read `docs/reference/AUTH-PROFILE.md` in the installed Sigloo package before creating a profile or test module.
Use `sigloo browser probe --json` only to diagnose the BrowserContext isolation primitive.

Never read or copy a user's existing browser profile unless a future Sigloo command explicitly requests approval
for import. Auth Profile state must be explicit, Space-local and non-merging. Do not print values returned by
cookie or localStorage getters.

## Control and visibility

Assume headless execution unless the user requests visibility. Viewer and takeover are not implemented in this
prototype; state that limitation instead of opening or controlling the user's normal browser.

If the user takes control of a future Viewer, stop agent actions until ownership is explicitly returned.

## Completion gate

Finish only after the command exit status and cleanup receipt agree. Report the Space ID, evidence path, test
outcome and cleanup status. Never infer success from visible output alone.
