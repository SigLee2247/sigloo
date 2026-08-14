# ADR-SIGLOO-008 Tool-agnostic Run Evidence

- Status: accepted
- Date: 2026-08-14

## Context

Sigloo must run existing Playwright, shell and future E2E tools without replacing their test syntax. The earlier
Process Space preserved exit status and one bounded report, but did not retain stdout, stderr or a predictable
place for tool-produced traces, reports and screenshots.

## Decision

Keep `sigloo run <space> -- <existing command>` as the compatibility interface and add a tool-agnostic artifact
contract.

- Every Process run creates owner-only `logs`, `trace`, `report` and `screenshots` directories.
- The child receives their paths through `SIGLOO_ARTIFACT_DIR`, `SIGLOO_LOG_DIR`, `SIGLOO_TRACE_DIR`,
  `SIGLOO_REPORT_DIR` and `SIGLOO_SCREENSHOT_DIR`.
- Stdout and stderr are mirrored to the caller and captured in owner-only files.
- The bounded JSON evidence inventories regular files by kind, path and byte count without embedding contents.
- Command exit status and Sigloo cleanup remain separate, and failures identify the command step and test/driver category.
- `sigloo report <space>` reads the last bounded report while the Space evidence remains available.

## Consequences

Existing test commands remain unchanged. Playwright and other tools can bind their own output configuration to
the standard environment paths without becoming Sigloo dependencies. Raw command logs may contain data printed
by the invoked tool, so they remain private artifacts and are not embedded in the default report or receipt.
