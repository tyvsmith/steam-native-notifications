# Task 1 report

Implemented deliverable A; implementation commit `0a81512bd0ec318e29b744f0224580f421751f50`.

## Files and interfaces

- `shared/settings.ts`: `SETTINGS_SCHEMA` owns all eight boolean fields (`type`, `default`, `label`, `description`, `group`, `platforms`, `developer`, `visible`). Exports `SettingKey`, `Settings`, `PresentationSettings`, `Platform`, `DEFAULTS`, `PRESENTATION_DEFAULTS`, `isSettingKey`, `normalizeSettings`, `validateSettingsPatch`, `settingSupported`. Reads normalize missing/malformed values to existing defaults; writes strictly reject unknown keys/non-booleans. Existing Windows preferences survive Linux reads.
- `shared/host.ts`: `PROTOCOL_VERSION = 1`; `BuildIdentity = { protocolVersion: 1, version: string, buildId: string }`; `BUILD_IDENTITY` comes from deterministic generated source SHA256. `HostKind = 'millennium' | 'standalone'`; `HostCapabilities` has `settingsWrite`, `settingsSubscribe`, `notificationCenterOnly`, `focusSteam`, `developerCommands`; `hostCapabilities(kind, platform)` describes existing frontend transports.
- `HostMethods` preserves existing positional tuples for Notify (six strings), Identity, Platform, Log, GameHostFocus, TakeDevCommand, TakeClick, FocusSteam. `RuntimeHost.call`, `FfiFactory`, `createRuntimeHost`, `bindHostMethod` provide actual typed frontend consumers while retaining Millennium's ffi compatibility. Methods are cached per adapter, matching original one-binding-per-method behavior. `parseCallableJson` supports raw/once/twice encoded JSON.
- `SettingsHost` provides `read(): Promise<Settings>`, `write(Partial<Settings>): Promise<OperationResult<Settings>>`, `subscribe(listener): () => void`. `SettingsTransport` supplies `getAll`, optional per-key `set`, and subscription. `createSettingsHost` normalizes reads and validates writes; absent set returns explicit unsupported. Current standalone CEF adapter intentionally remains read/subscription-only. Later control/config store can implement independent writable transport.
- `OperationResult<T>` is `{ ok: true, value: T } | { ok: false, code: 'unsupported' | 'invalid' | 'disabled' | 'unavailable', message: string }`.
- `DiagnosticResult = { host, build, frontendBuild: BuildIdentity | null, capabilities, state: string }`.
- `DeveloperRequest = { id: string, command: string, args: unknown[] }`; `DeveloperResult = { id: string, stage: 'queued' | 'executed' | 'captured' | 'delivery-attempted', result: OperationResult<unknown> }`. These are narrow neutral envelopes; later task owns parsing/allowlists, control protocol and execution correlation.
- `frontend/host.ts` supplies typed positional host binding. Runtime, log, platform, overlay, devfire and clickbridge consume it. `frontend/settings.ts` consumes SettingsHost/schema; panel labels/descriptions and presentation defaults come from schema. `standalone/host.ts` uses same normalizer/defaults, readiness includes build/capabilities.
- `frontend/runtime.ts` and standalone browser expose `globalThis.__snnFrontendBuild`. `tools/gen-build-identity.ts` hashes sorted source paths/content and package version, excluding generated identity; both build scripts invoke it. `shared/build-identity.json` is committed so typecheck and direct packing work without prior generation. `tsconfig.json` includes shared; normal test script includes contracts.

## Verification

Bun executable: `/home/ty/.local/share/mise/installs/bun/1.4.3/bin/bun`.

- `bun run typecheck`: passed.
- `bun run build:standalone`: passed (generation, typecheck, browser bundle).
- `bun node_modules/@steambrew/starlight/bin/starlight.js pack -o dist`: passed; local 92.54kB .star; no live installation.
- `bun test shared/contracts.test.ts standalone/host.test.ts standalone/browser.test.ts`: 18 passed.
- `bun test tools/presentation.test.ts`: 35 passed.
- `bun test tools/platform.test.ts`: 1 passed.
- `bun tools/test-routes` and `bun tools/test-frontend`: passed.
- `bun test standalone/browser.test.ts tools/click-dispatch.test.ts`: 89 passed.

Tests are transport/fixture evidence, not live or other-platform runtime verification. Platform and presentation tests run separately because their Millennium module mocks have distinct exports.

## Concerns and handoff

- Next task owns validated atomic config persistence, retaining last valid external edits, writable standalone config transport and any socket/UI access. This task deliberately preserves current host file-read fallback semantics.
- Capabilities here describe frontend compatibility adapters; a later writable standalone control endpoint must advertise its own write capability rather than reuse the read-only CEF description unchanged. Runtime dependency availability still needs doctor diagnostics.
- Build identity generation must run before release packaging after source edits. It identifies exact source inputs, not emitted artifact checksum/signature.
- No backend BuildIdentity RPC has been added to Millennium Lua; frontend build exposure and shared identity are available to subsequent status/control work without inventing unsupported backend methods.
- Full socket-dependent standalone suite and complete backend suite were not rerun here; coordinator baseline already covered 40 standalone tests. Relevant affected suites above passed.
- Dependency `.millennium` symlink was replaced with an ignored local copy to keep Starlight-generated type writes inside the assigned checkout; original dependency/source checkout and live Steam/service/settings were untouched.
- Commit signing agent was unavailable; explicit commit used command-local `commit.gpgsign=false`, without changing repository/user configuration.
