---
name: sigloo-process
description: Run existing shell, Node, Playwright or test commands inside Sigloo Process Spaces with preserved project cwd, isolated scratch/artifact directories, bounded evidence and deterministic cleanup. Use when an existing E2E or build command must run away from the user's active environment.
---

# Sigloo Process

Preserve the existing command. Sigloo does not require a test DSL and Process Space is not an OS sandbox.

## Workflow

1. Run `sigloo setup --json`.
2. For one-shot work use `sigloo run --name NAME -- COMMAND ARG...`.
3. For reconnectable work create a Space, then use `sigloo run SPACE -- COMMAND ARG...`.
4. Point tools at `SIGLOO_TRACE_DIR`, `SIGLOO_REPORT_DIR`, `SIGLOO_SCREENSHOT_DIR` and `SIGLOO_ARTIFACT_DIR` when needed.
5. Read `SIGLOO_RECEIPT` or `sigloo report SPACE --json`.
6. Require the command result and cleanup receipt to agree.

## Boundaries

- The child keeps the invocation/project cwd and can modify project files.
- Ownership and Space metadata are logical local boundaries, not OS security boundaries.
- Do not put credentials in Space names, command arguments or evidence paths.
- stdout/stderr are captured privately; inspect raw logs only when necessary.

## Example

```bash
sigloo run --name checkout-e2e --evidence-dir .sigloo/evidence -- npm test
```
