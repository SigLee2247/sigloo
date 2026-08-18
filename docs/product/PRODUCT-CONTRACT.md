# Sigloo Product Contract

- Status: MVP implementation complete
- Product: Sigloo
- CLI: `sigloo`
- Visual motif: igloo
- Repository visibility: private

## Promise

Sigloo gives each E2E run a named Space so an Agent can test browser, process and application surfaces without
competing with the user's active tabs, application data, focus, keyboard input source or clipboard.

## MVP

- Browser, Process and experimental Desktop Space
- Space ownership, TTL, reconnect and deterministic cleanup
- BrowserContext and storage isolation
- dedicated Auth Profile with per-Space derived state
- browser, shell and Playwright-compatible execution
- optional read-only Viewer and explicit user takeover
- screenshot, trace, log, report and cleanup receipt
- companion `$sigloo` Skill backed by the CLI

## Authentication rules

- Dedicated Sigloo Auth Profile is the default.
- Existing browser import is explicit and requires user approval.
- Each Space receives an independent derived authentication state.
- Space changes never merge back automatically.
- Agent-facing output never exposes cookie, password or token values.

## Product boundary

Sigloo owns its Space lifecycle, authentication boundary, control handoff, evidence and cleanup behavior. It may
study public implementations and installed products to improve interoperability and quality, but the shipped
runtime and product contract remain independently owned by Sigloo.
