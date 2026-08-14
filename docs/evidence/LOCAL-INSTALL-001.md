# LOCAL-INSTALL-001 Evidence

- Date: 2026-08-14
- Decision: ADR-SIGLOO-009
- Result: passed

## Acceptance evidence

| Check | Expected | Result |
| --- | --- | --- |
| Install | source checkout produces an owned `sigloo` launcher | passed with a content-addressed release and symlink |
| Restart | installed launcher starts in a fresh child process | passed with `sigloo --help` outside the release tree |
| Setup | runtime data root is initialized owner-only | passed; no group or other permission bits |
| Skill | `$sigloo` installs atomically with valid frontmatter | passed; owner-only file and matching digest |
| Update | repeated install selects the same immutable release | passed with identical SHA-256 digest |
| Uninstall | owned launcher is removed without deleting data | passed; release remains readable |
| Ownership | unrelated command is not overwritten | passed; non-symlink launcher is refused |
| Real install | default user paths work from a fresh shell process | passed; setup, Skill install and Space lifecycle |
| Regression | browser, Viewer, lifecycle and evidence tests remain green | passed; 16/16 tests |

## Commands

```text
npm run check                    passed
node --test test/install.test.mjs passed
npm test                         passed (16/16)
npm run spike:browser            passed (6 contexts, no remaining resources)
installed CLI lifecycle          passed (create, run, report, destroy)
git diff --check                 passed
```

## Boundary

This milestone provides a local macOS installation lifecycle. It does not publish a package, modify shell startup
files, push a repository, or garbage-collect retained releases. A new Codex session is required for Skill discovery.
The optional Skill Creator Python validator was unavailable because its local `yaml` module dependency is absent;
the E2E instead verified the required `name: sigloo` frontmatter, installed digest and owner-only file mode.
