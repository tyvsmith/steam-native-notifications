# Task 2 report

Implemented common control, configuration persistence and developer tools in the isolated product checkout. No live Steam, service, desktop settings, installation or push operations were performed.

## CLI and existing tools

- `standalone/cli.ts` exports `parseCommonOptions(argv)` and `runCli(argv)`. Public syntax: `snn [--host auto|millennium|standalone] [--json] status|doctor|capture [n]|dev fire <tools/fire arguments>`. Source invocation is `bun standalone/cli.ts`, or `bun run snn`. Task 4 owns compilation/install entrypoints. There is no public configuration CLI.
- `tools/fire` retains client Test arguments, wishlist/server, overlay-info and replay inspect/invoke forms and adds the same host/JSON options. Commands are strictly validated before queueing. `TestIncomingVoiceChat` is explicitly blocked. Other arbitrary store methods are refused; approved names are the observed methods listed in `shared/dev-command.ts`.
- `tools/capture [n]` adds host/JSON options. `tools/lib/cli/capture-millennium.ts` retains the original complete report: installed .star checksum, runtime freshness verdict, source age, startup/hook verdicts, notification/click/replay logs, and Windows toast database evidence. `captureReport(entry,count): Promise<string[]>` exports that report for the common client/JSON/UI. Standalone capture includes live identity/hook state and bounded historical logs.
- `tools/mep` remains Millennium protocol-only and unchanged.
- Status/doctor show both hosts. Automatic mutations require exactly one ready host; ambiguity or unavailable/degraded state is refused. Explicit host selection permits choosing the intended ready host. Millennium uses existing MEP `plugin.status`/config operations and atomic backend command files; no standalone MEP protocol was invented.

## APIs for Task 3

`standalone/client.ts` exports:

```ts
type HostSelection = 'auto' | 'millennium' | 'standalone';
hostStatus(): Promise<any[]>;
selectHost(selection: HostSelection = 'auto', mutation = false): Promise<HostKind>;
readConfig(selection: HostSelection = 'standalone'): Promise<ConfigSnapshot>;
updateConfig(patch: unknown, selection: HostSelection = 'standalone'): Promise<ConfigSnapshot>;
resetConfig(selection: HostSelection = 'standalone'): Promise<ConfigSnapshot>;
capture(count = 8, selection: HostSelection = 'auto'): Promise<unknown>;
fire(command: unknown, selection: HostSelection = 'auto'): Promise<unknown>;
sample(selection: HostSelection = 'auto'): Promise<unknown>;
```

`ConfigSnapshot = { values: Settings; error: string | null }`. Configuration failures reject update/reset; reads report malformed-file errors alongside last-good values. UI should catch rejected writes and render the reported error. Shared `SettingsHost.write` now converts transport failures into `OperationResult` unavailable failures (partial writes may already have applied on per-key Millennium transport).

`standalone/config-store.ts` exports `configPath()`, `configStore(path?)`, and `ConfigStore(path)` with `read(): Promise<ConfigSnapshot>`, `update(patch: unknown, deadline = Infinity): Promise<ConfigSnapshot>`, `reset(deadline = Infinity): Promise<ConfigSnapshot>`. Offline UI can use the same store without a daemon. `configStore` caches an instance per path. Config defaults and metadata still come from `shared/settings.ts`.

Writes strictly validate known booleans, preserve all unrelated/unknown fields and Windows preferences, use unique mode0600 temporary files and atomic rename, and serialize through both a per-instance queue and a bounded cross-process kernel flock. Lock files use O_NOFOLLOW/CLOEXEC and owner/type checks; kernel ownership disappears on crash. Invalid external edits preserve last-good values and are reported; updates refuse to overwrite malformed files until repaired. Deletion restores defaults. The control path passes request deadlines through settings writes so lock waits cannot cause expired writes.

The UI's sample API takes only host selection. Both hosts use the shared frontend executor with a fixed `TestFriendOnline` command, ignoring any supplied method/arguments, independent of devFire. It exercises Steam's existing toast/capture path; Steam's own preferences/persona gates can suppress a toast. Developer commands still require devFire. A completed execution is never described as a captured notification, delivered banner, or visible banner.

## Private standalone control

`standalone/control.ts` exports `controlPath()`, `startControl(handler,path?)`, `controlCall(operation,payload?,{path?,timeoutMs?})`, and request/reply types. Socket lives at `$XDG_RUNTIME_DIR/steam-native-notifications/control.sock`, requires an absolute owned runtime directory, owned mode0700 private subdirectory and mode0600 socket. Clients validate owner/type/permissions before connecting. Existing socket/files and symlink directories are refused rather than replaced.

Allowlisted operations: `status`, `capture`, `config.read`, `config.update`, `config.reset`, `dev.fire`, `sample`. Protocol is bounded newline JSON with correlation IDs/deadlines, fragmented/pipelined frame support, globally serialized operations, per-connection pending limits and bounded connections/replies. There are no arbitrary JS or method-evaluation endpoints. Disconnected/expired queued requests are skipped. Shutdown closes clients and removes only the socket inode it created. An owned Linux Unix fd is bound through Bun FFI and supplied to net.Server, because a path-bound net.Server otherwise deletes replacement files before an ownership check. Regression coverage proves replacement preservation.

The daemon polls live frontend build/hook/control availability alongside binding health, preserving the actual identity of an older already-injected frontend. Readonly status returns daemon build, installed frontend bundle build, observed frontend build, hook state, configuration health and helper dependency availability. Older bundles report degraded state and an actionable full Steam restart message. Context destruction clears live control state; old context generations cannot dispatch commands.

The shared frontend executor returns request-scoped executed/failure results. Millennium preserves the command-file fallback and reports queued/unconfirmed rather than claiming execution. Commands carry issue time and expiry; the frontend rejects requests predating its start, expired commands and legacy commands without expiry. Fixed samples use new typed `TakeSampleCommand` in both backend/standalone adapters. Correlated frontend result logs remain available through capture. No outcome claims are inferred from unrelated logs.

## Verification

Bun: `/home/ty/.local/share/mise/installs/bun/1.4.3/bin/bun`.

- `bun run build:standalone`: passed, including generated identity, typecheck, browser build and `dist/standalone/build.json`.
- `bun run test:standalone`: passed, 51 real standalone/socket/host/config/browser/setup/CDP tests plus 3 isolated shared host-client contract scenarios. Socket-dependent tests ran with sandbox escalation against temporary fixtures only.
- `bun run test`: passed (backend, routes, frontend, 168 tools/click/protocol tests, 6 shared contracts, 35 presentation, 1 platform, Lua native/gamescope focus checks). Output retained at `/tmp/task2-full-tests.log`.
- Local Millennium pack `bun node_modules/@steambrew/starlight/bin/starlight.js pack -o dist`: passed, 94.46 kB artifact; nothing installed.
- After the final legacy expiry refusal adjustment, rebuilt/typechecked standalone, reran the affected real browser suite (4 tests passed), repacked Millennium and checked the diff.
- Tests cover malformed/oversized/unsafe socket requests, path/permissions, fragmentation/pipelining, timeout/serialization, replacement-safe cleanup, independent writer processes, strict config/default/unknown-key preservation, invalid external config, both host-client seams, auto ambiguity/offline refusal, stale frontend builds, disabled/unsafe developer commands, safe fixed samples, execution failure, expiry and frontend restart rejection.

## Limits and packaging handoff

- Live Steam/UI behavior and other-platform execution are unverified; fixtures/builds are the evidence. Millennium backend readiness is measured through MEP, while frontend hook/build identity remains explicitly unmeasured by its existing external protocol. Queued Millennium results are not execution acknowledgements.
- Source-backed standalone runtime uses `dist/standalone/frontend.js` and `dist/standalone/build.json`; Task 4 must resolve/embed both with packaged assets and preserve the actual observed frontend identity.
- Private control/config locking currently target native Linux and libc, matching standalone support. Task 3 should use per-key MEP for Millennium settings on other platforms.
- A daemon crash can leave its mode0600 socket path. Startup deliberately refuses an existing path; recovery requires removing the verified stale socket before restart. Graceful shutdown removes its own socket automatically.
- Capture/replay/click pipeline semantics and delivery policy were not redesigned. Developer results prove execution only; capture/delivery/banner visibility stay unmeasured without correlated evidence.
- No blockers for Task 3. Full Steam restart is required when eventually installing the new frontend/backend.

Implementation commit: `1126680` (common control, developer tools, persistence and verification/report). Commit signing was disabled for this commit only because the signing agent was unavailable in this environment.

## Task 2 review corrections

Resolved all four findings from `task-2-review.md` in a scoped follow-up:

1. **Crash recovery:** the daemon supplies its actually held exclusive kernel-lock release handle to `startControl(..., { exclusiveLock })`. A private WeakSet tracks held daemon locks, so a caller cannot enable recovery with an arbitrary flag/function. Existing paths are reclaimed only when they are current-user mode0600 sockets, the bounded live probe reports ECONNREFUSED, the real lock remains held, and a second stat confirms the same inode/device/owner/type/mode. Live, foreign, ordinary-file, uncertain and replacement paths remain untouched. The earlier crash-left socket limitation is superseded by automatic verified recovery. A subprocess SIGKILL fixture proves lock release, stale-path retention, protected refusal without exclusivity, successful recovery, live-listener preservation and replacement-file preservation.
2. **Host isolation:** standalone `TakeDevCommand` always returns empty and never opens/deletes Millennium's `.dev-fire`. Standalone mutations exclusively use private control. The actual standalone Host and actual Lua backend module run against one temporary shared cache in the regression fixture; standalone polling leaves the explicitly Millennium-targeted envelope intact and Millennium consumes it.
3. **Late replay:** developer execution rechecks deadline, settings gate and frontend generation/activity after awaited surface discovery, immediately before invoking the replay handler. The poll now returns a disposer, and runtime teardown invalidates that generation and removes its control function. Delayed-expiry and teardown-during-discovery fixtures both prove zero replay invocations.
4. **Overlay results:** missing GetOverlayBrowserInfo fails explicitly, rejected API calls propagate their error through the correlated result, and successful calls return the actual measured info. Diagnostic logs remain, without swallowing awaited errors.

API refinement: `startControl(handler, path?, options?: { exclusiveLock?: () => Promise<void> })`; recovery requires a still-held release handle returned by `acquireDaemonLock`. `startDevFirePoll(): () => void` now supplies its lifecycle disposer. Other Task 3 API signatures are unchanged.

Affected verification with Bun 1.4.3:

- `bun run typecheck`: passed.
- `bun test standalone/control.test.ts` (isolated socket escalation): **7 passed**, including real child SIGKILL/restart recovery.
- `bun test standalone/devfire-execution.test.ts standalone/host-isolation.test.ts`: **4 passed**, including delayed expiry, frontend teardown, missing/rejected/successful overlay API, and both real backend adapter queue seams.
- `bun run build:standalone`: passed, regenerated build identity and emitted bundle metadata.
- `bun test standalone/browser.test.ts standalone/host.test.ts`: **13 passed**, actual browser bundle plus affected standalone host behavior.
- Isolated Millennium pack to `dist`: passed, **94.86 kB**.
- `git diff --check`: passed.

No live Steam, services, settings, desktop changes or pushes. Unaffected broad suites were not repeated. Follow-up implementation commit is supplied in the coordinator response.
