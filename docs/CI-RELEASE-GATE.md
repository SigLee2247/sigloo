# CI and release gate contract

## Required gate

Every CI run executes:

```bash
npm run check
npm test
npm run release:gate
```

`release:gate` covers 100 Browser runs, concurrent isolation, crash recovery, install/update/uninstall and cleanup.

## Desktop gate

When an Electron app is available, run:

```bash
SIGLOO_DESKTOP_APP=/absolute/path/to/app \
SIGLOO_ELECTRON_PATH=/absolute/path/to/Electron \
SIGLOO_DESKTOP_TERMINAL=1 \
SIGLOO_DESKTOP_IPC=1 \
npm run release:gate:desktop
```

The Desktop gate requires three unique Spaces, offscreen execution, renderer readiness, terminal command output,
IPC roundtrip and deterministic cleanup. CI can enable the optional job with repository variables named
`SIGLOO_DESKTOP_APP` and `SIGLOO_ELECTRON_PATH`.

## Unified local command

```bash
npm run release:gate:all
```

This always runs the Browser/Process gate. It runs the Desktop gate when both Desktop variables are set and reports
an explicit `skipped` result otherwise; a skipped Desktop gate is not evidence of Desktop readiness.
