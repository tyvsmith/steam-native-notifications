# Task 3: independent standalone settings UI

Implemented `snn settings [--no-open]` with an on-demand native Linux browser page. No public config get/set/reset commands or Steam window integration. Explicit `--host millennium` explains that Millennium uses its existing panel. Auto settings edits target standalone even offline; safe sample always explicitly targets standalone, avoiding dual-host ambiguity.

## Interfaces and package layout

- `standalone/settings-server.ts`: `startSettingsServer(options?: {store?: ConfigStore, host?: HostSelection, status?: typeof hostStatus, sample?: typeof sample, idleMs?: number})` returns `{url, origin, stop, closed}`. `settingsCommand(noOpen = false, host = 'auto')` prints the local URL, opens `xdg-open` via argv, waits until shutdown. Ctrl+C/SIGTERM, authenticated Close settings, or 30 minutes idle stop the listener. Random ephemeral loopback port avoids 8080 conflicts.
- `standalone/settings-assets.ts`: `settingsHtml`, `settingsStyle`, `settingsScript` strings are embedded in the compiled Bun executable by normal imports; **no external settings assets or additional build step needed**. Server serves `/`, `/settings.css`, `/settings.js`.
- Narrow JSON API: GET `/api/state`; POST `/api/config` (shared validated boolean patch), `/api/reset` (empty object), `/api/sample` (empty object), `/api/close` (empty object). All API operations require `Authorization: Bearer <session token>`. Token is in launch URL fragment, cleared from browser address/history on load, retained in per-origin tab sessionStorage to support reload; cleared on explicit close or unauthorized response, never query or server request logs. Console launch URL is intentionally printed for --no-open/browser failure; no server access logging.
- `standalone/cli.ts` delegates only settings command. Packaging dispatcher should call `settingsCommand` directly or preserve CLI delegation. Server config uses existing `configStore()` XDG path, without a lifetime config lock. UI writes shared JSON atomically, preserving unknown values and unsupported platform preferences. Existing daemon/Host refresh adopts those writes without restart.
- `standalone/settings-fixture.ts /tmp/<fixture>/config.json ready|offline|stale`: isolated coordinator browser fixture. Fake sample is explicitly identified as fixture-only. No live control/config/notifications are accessed.

UI uses shared schema/defaults/validation, outside/inside controls, disabled Windows-only controls, out-of-band devMode gate, opt-in devFire, build/version/connection/restart action, reset confirmation, fixed safe sample and shutdown. Server checks exact numeric loopback Host and same Origin when present, rejects other methods/query strings, limits request bodies to 8192 bytes, requires JSON for mutations, provides no CORS, and sets restrictive CSP/no-store/nosniff/no-referrer. Messages render through textContent. No capture/private notification API or persistent browser storage of notification contents.

Review followups: SettingsPanel metadata now chooses the same in/out key as its toggles. New parity tests bundle the actual frontend/settings consumer with the actual standalone config exports; verify updates, removals, malformed normalization and readonly writes. Mocked Millennium module boundary also exercises actual frontend consumer and typed unavailable write exceptions. Shared host already catches typed transport exceptions consistently from Task 2.

## Verification

Bun 1.4.3 at `/home/ty/.local/share/mise/installs/bun/1.4.3/bin/bun`:

- `bun run typecheck` passed.
- `bun run build:standalone` passed, generated frontend/build metadata.
- `bun test standalone/settings-parity.test.ts standalone/browser.test.ts`: 7 passed; actual bundle and adapters.
- `bun test standalone/settings-server.test.ts standalone/config-store.test.ts standalone/host.test.ts`: 16 passed before final additional stale-sample rejection test; final server rerun recorded below. Socket tests needed sandbox escalation and used only temporary fixtures/ephemeral loopback.
- Isolated Millennium `starlight pack -o dist` passed (94.89 kB); installed nothing.
- `git diff --check` passed.

Coverage: missing bearer, wrong Host/Origin, methods/query strings, content types, malformed/oversized bodies, unsupported/developer writes, offline persistence/reset/unknown-key preservation, invalid external edits/last-valid refusal, actual Host live refresh, safe sample payload refusal, explicit stale frontend failure, startup/shutdown/idle/CSP. Existing config tests prove independent process serialization.

Coordinator browser check identified a reload authentication bug; fixed with per-origin tab sessionStorage and added actual script bootstrap/reload/close regression. Build hash prominently shows 12 characters with full hash in hover diagnostics. Final server suite: 5 passed; parity suite: 4 passed. Actual interactive browser save/reload/status/sample rechecks are delegated to coordinator's available CUA; no live Steam/desktop/service modifications, pushes, or notifications occurred here. Other platforms are outside standalone target. Real Steam sample/delivery remains live validation rather than fixture evidence.
