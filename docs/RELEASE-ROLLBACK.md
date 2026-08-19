# Local release rollback

Sigloo releases are immutable content-addressed directories. The launcher can be pointed at a retained release
without deleting runtime data:

```bash
node scripts/install-local.mjs rollback \
  --digest <64-character-release-sha256> \
  --install-root ~/.local/share/sigloo \
  --bin-dir ~/.local/bin
```

Rollback verifies the release manifest, refuses non-owned launchers and atomically replaces only the Sigloo symlink.
The previous release remains retained so a second rollback is possible. Runtime Spaces, evidence and Auth Profiles
are not removed.
