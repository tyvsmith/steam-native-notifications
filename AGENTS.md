# AGENTS.md

A Millennium plugin that mirrors Steam's in-client notification toasts to the
desktop notification daemon, preserving the artwork and the click action.
(CLAUDE.md is a symlink to this file.)

`docs/architecture.md` is the full context: the pipeline, the log
vocabulary, verified facts, testing methodology, and dead ends. Read it
before non-trivial work. `docs/steam-routing.md` is the analysis of Steam's
own click handling; `docs/notification-types.md` maps type numbers to names;
`docs/regeneration.md` records the catalog/schema restoration procedure;
`docs/platforms.md` is the platform support matrix (Linux native shipped;
Flatpak paths ready, host unsupported; Windows canonical activation validated
programmatically in one VM; macOS refuses to deliver, loudly)
and the delivery plan for each.

## State

**Clicks are exact replay plus a durable route.** At capture time
frontend/replay.ts stashes Steam's proved click handler and capture surface
under a random token; the restored schema/catalog derives a verified fallback.
The versioned click
envelope carries token, capture appid, fallback, and Windows focus target. On
a matching live surface the bridge replays Steam's handler. On a focus change,
missing stash, replay throw, or Steam restart it dispatches the fallback against
current focus. Ambiguous handlers are never replayed; a verified catalog
fallback can still route. The stash's capture surface is authoritative; a URL
cannot move a callback to another surface. Unknown or contradictory current
surface discovery refuses dispatch. Group chat has exact replay only because
its room dispatcher requires session-only toast context. Without either safe
action, the click is inert.

The replay stash retains the latest 256 chosen closures for the Steam session,
with no time expiry. Heap measurements found current handlers under 0.5KB each
and no detached documents. The closures stay in RAM and disappear when Steam
restarts. Durable data is encoded in
`steam://steam-native-notifications/notification/<base64url-envelope>`, not in the
heap or on plugin disk.

Linux launches that URL after a live `notify-send` default action. Quickshell
also receives `omarchy-exec-argv` with a fixed `steam`, URL argv pair for
Quattro history. Other FreeDesktop daemons do not promise a reboot-durable
executable action. Windows stores the same URL in the WinRT toast. Linux
validated stored-argv replay and Achievement fallback after restart/cold start;
UI clicks, visual focus, and shell/login restart remain untested. Windows
validated canonical history storage, exact replay, and Achievement fallback
after restart/cold start through active-session protocol invocation. UI clicks,
visual focus, and a clean guest reboot remain untested. Subsequent surface and
dispatch-completion fixes have offline coverage only. See `docs/platforms.md`.

## Commands

```sh
bun run build          # type-check, pack + install the .star
bun run typecheck      # tsc --noEmit on its own
bun run test           # backend, routes, toast decode, chooser, click dispatch
tools/capture          # is the running .star current, did the hook attach,
                       # what did the last notifications carry
tools/fire TestFriendOnline   # push a real test toast through Steam's pipeline
                              # (needs the devFire toggle; the developer toggles
                              #  only appear in the panel with devMode set in
                              #  Millennium's config store -- seed it via
                              #  tools/mep or the config file, see live-verify)
tools/fire --server 3 '{...}' # inject a server rollup through OnServerNotification
tools/mep --methods    # talk to Millennium's external protocol (dev only)
tools/fire --replay inspect   # dump the stashed handler candidates
tools/fire --replay invoke    # invoke the latest stashed handler (no click)
tools/notify-action --resolve-icon <url>
```

The three dev tools are bun scripts (`#!/usr/bin/env bun`, no extension) and
run on every platform from the same files; on Windows prefix them with
`bun` (`bun tools/fire TestFriendOnline`). Their shared paths live in
`tools/lib/snn.ts`, which also mirrors the log-prefix contract `frontend/log.ts`
owns; Millennium's external protocol (socket path, framing, transport) is
`tools/lib/mep.ts`. `bun test tools/devtools.test.ts tools/mep.test.ts
tools/snn.test.ts tools/toastdb.test.ts` pins the argument grammar, the
msgpack codec, the MEP framing and transport against a stub socket server,
exact integers, the toast-XML reader, the log-prefix regexes and platform
paths, and the notification-database reader.

Install: `bun install`, then `bun run build`; starlight packs the plugin as
`me.tysmith.steam-native-notifications.star` into Millennium's plugins directory for
the platform — `<Steam install>\millennium\plugins\` on Windows,
`${XDG_DATA_HOME:-~/.local/share}/millennium/plugins/` on Linux,
`~/Library/Application Support/Millennium/plugins/` on macOS — so building IS
installing. Enable under Millennium > Plugins.

Plugin log: `~/.cache/steam-native-notifications/plugin.log` (Windows:
`%LOCALAPPDATA%\steam-native-notifications\plugin.log`), truncated at each
backend load (Millennium buffers a packed plugin's logger output away from
Steam's console log, so the backend mirrors it there). Millennium's own
loader lines are still in `~/.steam/steam/logs/console-linux.txt`, filtered
by `me.tysmith.steam-native-notifications`. Click triage reads the same log:
`replay: candidates` shows what each toast stashed, `click-bridge:` every
consumed click, `replay: invoke` what running the handler did (a throw is
logged verbatim, never propagated).

## Hard constraints

**A full Steam restart is required for ANY change, backend included.** Under
the .star format, `plugin.restart` and disable/enable leave the backend
stopped (`running: false`, immediate "backend unloaded" after load); the
frontend was already unreloadable ("Delegating frontend load" logs and does
not execute).

```sh
steam -shutdown && sleep 15 && setsid uwsm-app -- gtk-launch steam.desktop
```

`steam -shutdown` returns early, and a relaunch while the old instance lives is
silently swallowed. If Steam is not up after the sleep, launch again.

A healthy idle client can ignore `steam -shutdown` outright (observed three
times, 2026-08-30: the process survived 30s+). Standard recovery: watch
`pgrep -x steam` for up to ~30s, then `pkill -TERM -x steam`, wait ~8s, then
`pkill -KILL -x steam` and `pkill -KILL -x steamwebhelper`. Always `-x`,
never `-f` — a `-f` pattern matches the invoking shell.

**Confirm the running .star before diagnosing anything.** `tools/capture` says
so first. A stale build is indistinguishable from a broken feature.

**A green build proves very little.** Five runtime failures here were undefined
names or nil globals the bundler emitted happily. The build type-checks;
`bun run test` covers the Lua side, the toast decode, and the click chooser.
Run both, then confirm behaviour in the running client.

**Diagnostics must never throw.** A debug log calling `JSON.stringify` on a
BigInt silently killed every notification. Use `safeJson`; keep `dlog` wrapped.
The log prefixes in `frontend/log.ts` own the vocabulary; `tools/lib/snn.ts`
mirrors it for the tools and `tools/capture` greps it. `tools/snn.test.ts`
reads the producers and fails on a prefix none of them writes, so a renamed
prefix breaks the suite rather than silently blinding the triage tool.

**Frontend-backend RPC is Millennium's `ffi` bridge, positional.**
`ffi('Notify')(title, body, image, route, ingame, suppressPopup)` lands on the Lua parameters
in order (the old `callable` transport could not order a multi-key object,
which is why everything once travelled as one JSON string). A Lua string
return has arrived both raw and JSON-quoted across transports: unwrap only
what provably starts with a quote (clickbridge.ts).

**Settings live per-key in Millennium's config store.** The panel uses
`usePluginConfig`; the `settings()` snapshot loads via `pluginConfig.getAll`
and stays current through `subscribePluginConfig`. Missing values use defaults;
obsolete development settings are ignored. A write from any source (panel, backend,
`tools/mep`) reaches a running frontend without a restart.

**Presentation is independent per capture surface.** OS delivery defaults on
for desktop and game contexts; Steam visibility defaults off on desktop and
on in games. Windows-only Notification Center controls default off and appear
when the corresponding OS toggle is on. Both visibility toggles off closes
Steam without native delivery. Unknown capture surfaces preserve Steam.

## Testing notifications

**A Steam toast is only clickable while a Steam window has focus.** Unfocused it
takes no click at all. Any "Steam's toast does nothing" result taken unfocused is
meaningless, and produced three wrong conclusions in this project.

**Watch the client while clicking.** A `steam://nav/...` route changes a page
inside the existing window; unwatched, a working navigation looks like nothing.

**Clicks return through Steam's registered notification URL.** The Linux live
action launches it directly; Quattro can retain the fixed argv hint in history;
Windows stores it as the WinRT protocol target. Every accepted click logs a
`steam-url:` line followed by `click-bridge:` dispatch. No line means the OS
action did not reach Steam or the frontend is not running. The remaining
click-file poll is a legacy/test seam, not the Linux notification transport.

**Never fire TestIncomingVoiceChat.** A fake incoming call has no caller to
hang up: its notification never resolves, and once its toast has shown,
every later toast queues behind it until Steam restarts. Verified by A/B
with zero clicks and zero invokes (2026-08-29); not a plugin defect. Real
voice chats resolve when the caller hangs up.

**Read a failed `tools/fire` correctly.** No `dev-fire:` log line means the
settings toggle is off. A `dev-fire:` line with no `from-toast` line means one
of Steam's own gates ate the toast (SystemUpdate's weekly gate, the user's
notification preferences, a missing sender persona). The handoff's "Testing
methodology" section lists them.

Download completion is the only reliable real-event self-service trigger:

```sh
steam steam://uninstall/1073390 && steam steam://install/1073390   # Aircar, 0.89GB
```

Everything else needs tools/fire, another person, or a server-side event.
Design captures so one real notification yields everything needed; you may
only get one.

## Conventions

**Mirror Steam, do not invent.** A click that does nothing is correct when
Steam's own toast does nothing. Every invented route here had to be torn out.
When adding a route, cite the observation or Steam code path behind it.

**Prefer the React path over the notification feed.** Steam attaches its decoded
notification to the toast's React tree. The feed misses types entirely: an
incoming voice chat produces no feed event at all.

**Durable routing depends on the generated decode.** Client payload fields are
decoded from their positional `data.array` using the vendored protobuf schema.
The named fields feed `routes.ts`; a known malformed payload gets exact replay
only and otherwise fails closed. A type absent from the catalog opens Steam
generally after replay is lost. Regenerate through `bun run build`.

**Edit files directly, and verify the edit landed.** Positional splices and loose
regexes silently dropped edits and deleted a live declaration twice.

## Layout

```
millennium.toml           plugin manifest; starlight packs everything below
frontend/index.tsx        popup lifecycle: hook, wait, deliver   (Steam's CEF)
frontend/notification.ts  React tree -> typed notification (feeds the log)
frontend/toasttext.ts      preserve rendered localized copy; split title/body
frontend/click.ts         validate/encode the durable click envelope
frontend/replay.ts        stash Steam's handler by random token; invoke it
frontend/routes.ts        verified durable fallback catalog
frontend/choose.ts        which handler a click may invoke (pure, offline-tested)
frontend/fiber.ts         the __reactFiber discovery both walkers share
frontend/log.ts           dlog/safeJson; owns the log-prefix vocabulary that
                          tools/lib/snn.ts mirrors
frontend/clickbridge.ts   replay on matching surface; live-focus fallback otherwise
frontend/devfire.ts       tools/fire door, gated by a setting
frontend/SettingsPanel.tsx settings panel; settings.ts, per-key config store
backend/main.lua          marshaller + per-OS spawn seam (Millennium Lua host)
tools/notify-action       POSIX delivery; live action launches canonical URL,
                          Quickshell gets Quattro's fixed argv history hint
tools/notify-action.ps1   Windows delivery: WinRT toast, protocol-activation
                          click + one-shot route-aware focus (EXPERIMENTAL)
tools/lib/snn.ts          the dev tools' shared paths per platform and the log
                          vocabulary; mirrors backend/main.lua and frontend/log.ts
tools/lib/capture.ts      tools/capture's staleness verdict and newest-source rule
tools/lib/devtools.ts     tools/fire's argument grammar
tools/lib/toastdb.ts      what Windows recorded: the notification database and
                          the toast-XML reader
tools/lib/mep.ts          Millennium's external protocol: socket, framing, one
                          request -> one reply (tools/mep is the shell door)
tools/lib/msgpack.ts      the msgpack codec MEP speaks, exact integers
tools/lib/json.ts         JSON with exact integers past 2^53
frontend/steamurl.ts      register and validate the canonical Steam URL
```
