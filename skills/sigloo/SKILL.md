---
name: sigloo
description: Run and verify E2E work in Sigloo's isolated CLI Spaces. Use when an agent needs to execute tests or commands away from the user's active environment, inspect Sigloo driver readiness, verify Browser Space isolation, collect evidence, or confirm deterministic cleanup with the `sigloo` CLI.
---

# Sigloo

Use `sigloo` as the canonical interface. Do not replace its Space lifecycle with direct Playwright, CUA or shell
execution when Sigloo supports the requested surface.

If `sigloo` is unavailable, report that the local CLI must be installed; do not silently fall back to a different
isolation model. After installation, run `sigloo setup --json` once before the first Space.

## Workflow

1. Run `sigloo doctor --json` and inspect the requested driver's status.
2. Create a persistent Space with `sigloo create NAME --ttl 30m --json` when reconnect or multiple drivers are needed.
3. Select the narrowest available driver command and run it by Space name or ID.
4. Read the final `SIGLOO_RECEIPT` or JSON report.
5. Complete or destroy persistent Spaces explicitly. Treat `cleanup.resources_remaining: true` as a failed run.

After a previous Sigloo process was killed or the host restarted, run `sigloo setup --json` and require
`recovery.resources_remaining: false` before starting new Browser Spaces.

## Process Space

Run a command in a temporary working directory:

```bash
sigloo run --name checkout-e2e -- node /absolute/path/to/smoke-test.mjs
```

The command preserves the current project working directory so the existing suite runs unchanged. It receives
`SIGLOO_SPACE_ID`, a separate scratch `SIGLOO_SPACE_DIR`, and `SIGLOO_SPACE_DRIVER`. The prototype does not
provide an OS sandbox or prevent project writes. Preserve this distinction in user-facing claims.

For reconnectable work, use `sigloo run SPACE -- COMMAND` after `sigloo create`. Preserve the returned Space ID,
not an internal directory path. Do not change `SIGLOO_OWNER_ID` between create, inspect, run and destroy.

Do not rewrite an existing Playwright or shell suite. Run its original command after `--`. When configuring
framework artifacts, point them at `SIGLOO_TRACE_DIR`, `SIGLOO_REPORT_DIR` and `SIGLOO_SCREENSHOT_DIR`. Read the
latest bounded result with `sigloo report SPACE --json`; inspect raw stdout/stderr files only when necessary
because child output may contain sensitive values.

Use `--evidence-dir PATH` only when evidence must live outside the default `.sigloo/evidence` directory. Do not
put passwords, tokens or credential values in the Space name or command arguments.

## Browser Space

Use `sigloo auth list --json` to discover dedicated profiles and `sigloo auth select NAME` to choose the default.
If no suitable profile exists, create it with a canonical origin. Run `sigloo auth login NAME` only when the user
can take control of the temporary Viewer and explicitly press `Save login`; never automate that approval action.

Run an approved local browser test with an explicit Auth Profile:

```bash
sigloo browser run --name account-e2e --url https://app.example.test \
  --script /absolute/path/to/e2e.mjs --auth-profile /private/path/auth-profile.json
```

Read `docs/reference/AUTH-PROFILE.md` in the installed Sigloo package before creating a profile or test module.
Use `sigloo browser probe --json` only to diagnose the BrowserContext isolation primitive.

Prefer `snapshot`, `click`, `fill` and `key` over arbitrary `evaluate` calls for normal interaction. Take a fresh
snapshot after navigation or material DOM changes. Never print fill text, key values, cookie values or storage
values; verify outcomes with named assertions instead.

Never read or copy a user's existing browser profile unless a future Sigloo command explicitly requests approval
for import. Auth Profile state must be explicit, Space-local and non-merging. Do not print values returned by
cookie or localStorage getters.

## Control and visibility

Assume headless execution unless the user requests visibility. Add `--viewer` only on request. Open the temporary
URL from the `SIGLOO_VIEWER` line for observation; it is loopback-only, read-only and closes with the run. Use
`--viewer-hold-ms N` only for a bounded final-frame viewing window. Never print or persist the URL in evidence.

Viewer is read-only until the user explicitly selects `Take control`. While the Viewer reports user control, do
not issue separate browser operations or work around the control gate. Resume only after `Return to agent` is
confirmed. If the Viewer closes during takeover, treat the interrupted agent operation as a failed run.

## Completion gate

Finish only after the command exit status and cleanup receipt agree. Report the Space ID, evidence path, test
outcome and cleanup status. Never infer success from visible output alone.
For Viewer runs, also require `viewer.closed: true` and `cleanup.viewer_closed: true`.
