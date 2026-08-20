---
name: sigloo-process
description: Run existing shell, Node, Playwright or test commands inside Sigloo Process Spaces with preserved project cwd, isolated scratch/artifact directories, bounded evidence and deterministic cleanup. Trigger for '기존 npm test 격리 실행', '이 명령 그대로 돌려줘', '프로젝트 명령을 분리해서 실행', 'Playwright 명령 실행', 'run the existing command in a Space', or build/test process isolation requests.
---

# Sigloo Process

Natural-language triggers: “기존 명령 그대로”, “npm test 격리 실행”, “shell 명령 분리”, “프로젝트 cwd 유지”, “Playwright suite 실행”, “run this command in Process Space”.

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
