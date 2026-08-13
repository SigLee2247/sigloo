# SPIKE-002 ego-lite bundle observation

- Date: 2026-08-13
- Platform: macOS arm64
- Installed product: ego lite 0.4.6.13
- Bundle identifier: `com.citrolabs.ego.lite`
- Scope: read-only application-bundle and installed CLI observation
- User browser data inspected: none

## Question

Which observable product boundaries are useful when decomposing Sigloo's independent Browser Space runtime?

## Artifacts observed

| Artifact | Observation |
| --- | --- |
| Main application | signed and notarized arm64 macOS application |
| Main executable SHA-256 | `39fd2d0b10c258a6c2e9d92f272f8465106747b948117e0c76ae570b57cfda5a` |
| Chromium framework SHA-256 | `11e3ef3cd6973c8802db82926c86ad8e696747ea8dfeceb20272c787f77e58e3` |
| Native CLI helper | `ego-browser`, identifier `com.citrolabs.ego.ego-browser` |
| CLI helper SHA-256 | `6ead1ce64221f15998d9a6f1864d94b34b2c313f9f9a42632b7293de15c32299` |
| Active framework version | `Versions/Current -> 0.4.6.13` |
| Other retained versions | `0.4.5.8`, `0.4.6.12` |
| CLI installation | `~/.local/bin/ego-browser` links to an active-version helper |
| Bundled agent surface | a Skill document, install guidance and installer script |
| Browser automation surface | task spaces, tabs, snapshots, screenshots, JavaScript and raw CDP helpers |
| Control lifecycle surface | claim, handoff, takeover, wait and completion helpers |

The application framework contains ordinary Chromium runtime assets such as ICU data, resource packs, a V8
context snapshot and graphics libraries. Its AppleScript dictionary exposes Chromium-style window and tab
objects. The bundled Skill describes a CLI-accessible Node.js runtime whose scripts select a named task space and
call preloaded browser helpers.

## Observed architecture versus inference

Observed facts support three visible boundaries: browser application/runtime, native CLI helper and agent-facing
workflow contract. The Task Space API also exposes explicit ownership transitions between agent and user.

It is reasonable to infer that separating lifecycle from individual automation commands is valuable. The bundle
inspection does not prove internal storage implementation, BrowserContext allocation strategy, profile-copy
behavior or credential handling. Sigloo therefore treats those as requirements to verify independently rather
than assumptions about the observed product.

## Sigloo implications

- Keep `sigloo` as the canonical interface and put the companion Skill above that CLI.
- Make Space lifecycle independent from Playwright, CDP or future desktop drivers.
- Model control as an explicit ownership state machine; Viewer access stays read-only until takeover succeeds.
- Keep authentication derivation separate from runtime mutation and never expose credential values in output.
- Record tested product versions and artifact hashes when interoperability research affects a decision.

No installed executable, framework code, user profile, cookie database or credential material is included in the
Sigloo repository.
