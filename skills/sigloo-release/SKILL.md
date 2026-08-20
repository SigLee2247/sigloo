---
name: sigloo-release
description: Run Sigloo's release gates, inspect bounded evidence, verify Browser/Process/Desktop cleanup and manage immutable local release installation and rollback. Use before committing a release, after runtime changes or when validating a new installation.
---

# Sigloo Release

Use the narrowest gate that proves the change, then run the unified gate before a release decision.

## Commands

```bash
npm run release:preflight
npm test
npm run release:gate
npm run release:gate:desktop
npm run release:gate:all
```

Desktop gate requires `SIGLOO_DESKTOP_APP` and `SIGLOO_ELECTRON_PATH`; add `SIGLOO_DESKTOP_TERMINAL=1` and `SIGLOO_DESKTOP_IPC=1` for SigTerm coverage. A skipped Desktop gate is not evidence of Desktop readiness.

## Completion criteria

- all tests pass;
- Browser/Process gate reports 100 Browser runs, crash recovery and install lifecycle passed;
- Desktop gate reports unique Spaces and `resources_remaining: false`;
- `sigloo setup --json` reports ready and no recovery resources remain;
- installed CLI version and Git commit match the intended release.

## Rollback

Repoint the launcher to a retained immutable release without deleting runtime data:

```bash
node scripts/install-local.mjs rollback --digest HEX \
  --install-root ~/.local/share/sigloo --bin-dir ~/.local/bin
```
