# Architecture

A Millennium plugin that mirrors Steam's in-client notification toasts to the
desktop notification daemon, keeping the artwork and the click. Each click
carries both Steam's exact captured handler token and a catalog-derived durable
fallback. The bridge replays Steam's handler only while the click surface still
matches; otherwise, or after a Steam restart, it dispatches the verified route
against the live surface.

This file is the working context that is not obvious from the code. The rest
of the doc map: `docs/steam-routing.md` is the analysis of Steam's shipped UI
bundle (how its clicks actually work); `docs/notification-types.md` maps
every type number to a name and what Steam's click does;
`docs/experiments/click-replay.md` is the measured record behind the hybrid
design, including its incidents and memory result; `docs/regeneration.md`
records how the routing catalog and protobuf schema were restored from
`backup/routing-catalog`;
`docs/platforms.md` is the platform support matrix (the paths and calls
that differ per OS, and the delivery plan where nothing delivers yet).

## Standalone RT3 host

The native Linux x64 standalone package runs without Millennium, using a separately installed Bun runtime. Both hosts share notification capture, localized text,
presentation, replay, durable routes and the Linux notification helper.

| Boundary | Millennium | Standalone |
|---|---|---|
| Frontend loading and RPC | plugin loader and FFI | loopback CEF CDP and binding adapter |
| Preferences | per-key plugin config | serialized atomic JSON store |
| Settings UI | plugin panel | section in Steam Notifications settings |
| Developer commands | MEP config-change push, exported frontend handler and correlated replies | private Unix socket and correlated frontend execution |
| Installation | packed `.star` | Bun-owned application package, user service and autostart |

`shared/settings-policy.ts` owns visibility, dependent-control availability and preference
reset rules. Standalone test commands apply the latest saved preferences before
execution; serialized pushes cannot replace it with an older snapshot. Renderers and
storage stay with their hosts. An optional Steam panel
failure does not stop notification capture; offline config recovery uses the CLI.

`tools/lib/host-client.ts` owns host selection and common command dispatch;
`tools/lib/cli-options.ts` owns shared argument parsing. Millennium readiness
requires a fresh challenge reply with the expected frontend build, an installed
hook and live command control. Backend availability alone leaves actions disabled.
Command receipts carry the request ID and distinguish execution from an
unconfirmed delivery. They do not prove capture or visible desktop delivery.
The standalone section appends inside Steam's existing Notifications scroll
body, with an error boundary around only the extension. The private seam wraps
the observed synchronous page function in a stable component per native type,
calls it once with the original props, and clones only the discovered body
element. Other component shapes or body outputs remain unchanged. It adds no sidebar entry and
leaves Steam's page metadata and navigation callbacks intact. Both hosts offer
a fixed sample and confirmed reset; both panels share
visibility, reset policy, native controls, confirmation dialogs and sample-result wording.
`shared/settings-content.ts` owns the common view; removal is standalone-only.


Bun owns application files and command installation. Trusted package installation
attempts per-user integration setup; explicit setup remains available for repair.
The integration verifies daemon PID/build readiness, preserves stopped/disabled
service state and records owned service/autostart files. It never restarts Steam.
Teardown precedes package removal because Bun removal hooks are not reliable.
Settings and the shared CEF marker are preserved. See [installation](standalone-release.md),
[development setup](experiments/rt3-standalone.md), and
[validation scope](experiments/rt3-validation.md).

## The pipeline

```
Steam renders a toast (its own CEF popup window)
  frontend/runtime.ts     hook g_PopupManager, wait for paint, read the DOM
  frontend/notification.ts decode Steam's attached notification
  frontend/routes.ts      derive a durable fallback from the decoded fields
  frontend/replay.ts      walk the toast's fiber tree, stash its click handler
  frontend/choose.ts      which handler a click may run (pure, offline-tested)
  frontend/click.ts       make the versioned token/surface/fallback envelope
  backend/main.lua        marshal the payload to the helper
  tools/notify-action     Linux: live action launches the canonical Steam URL;
                          Quickshell also gets a fixed argv history hint
  tools/notify-action.ps1 Windows: store the same URL in the WinRT toast
  frontend/steamurl.ts    validate the URL and enter the shared dispatcher
  frontend/clickbridge.ts select replay or fallback for the live surface
       same surface       invoke the exact handler by random token
       changed/restarted  dispatch the durable route against live focus
  backend/main.lua        Windows only: request one route-aware focus pulse
```

`frontend/fiber.ts` owns the `__reactFiber` discovery both walkers share;
`frontend/log.ts` owns `dlog`/`safeJson`, whose prefixes are `tools/capture`'s
grep contract; `frontend/settings.ts` + `SettingsPanel.tsx` hold independent
Steam/OS controls for desktop and game contexts, Windows Notification Center-only
controls, and the test door behind `devMode`; `frontend/presentation.ts` resolves
a captured toast's policy and `frontend/platform.ts` caches the backend platform;
`frontend/devfire.ts` is the `tools/fire`
door, gated on the `devFire` developer toggle.

## Capture

Steam draws every toast as its own CEF popup named
`notificationtoasts_<N>_desktop` (no game focused) or
`notificationtoasts_uid<appid>-...` (rendered in a game's overlay context).
The identity portion is opaque: Steam uses a counter and Millennium synthetic
toasts currently use `undefined`. Only the `_desktop` marker or a bounded,
positive overlay appid determines the captured surface.
The window title is all the compositor sees; the text exists only in the
popup's DOM, which is why the reader runs inside Steam's own JS context.
`g_PopupManager` is not public API — it is what the shipping
kitsune-notifications plugin uses, which is the only reason to trust it.

The popup exists before it paints, so delivery polls for text (~1.2s) rather
than trusting a settle delay. Each popup name delivers at most once. Delivery
uses one settings snapshot per captured surface. The default-on
`integrationEnabled` master disables OS delivery and preserves Steam when off,
without modifying the saved context preferences. Both host panels disable
dependent controls and their test button while the master is off. Developer
opt-in remains independent. Changes affect subsequent captures.

With integration enabled, OS and Steam visibility are
independent: both enabled sends a copy and preserves Steam; both disabled
dismisses Steam without sending a copy. Replacing Steam with an OS notification
invokes the toast's bound `onDismiss` only after the backend acknowledges launching
delivery. Discovery requires the matching popup portal, notification identity and
one callback. Missing or ambiguous callbacks preserve Steam; callback failures
are logged without a raw-close fallback. Direct
CEF window closure bypasses native cleanup and can stall Steam's animation queue.
A failed request preserves Steam, but a successful launch does not establish
whether the OS displayed a banner. Unknown capture surfaces preserve Steam
and skip mirroring. Closing happens after capture, so a brief flash is possible.

Defaults enable OS notifications in both contexts and preserve Steam only
in games. Windows Notification Center-only preferences default off, appear
only when OS delivery is enabled, and set `SuppressPopup` before WinRT `Show`.
Linux ignores those preferences. Steam's capture surface can lag after
alt-tab, so an explicitly silent game-context copy can remain silent there.

## Push and recovery

Neither host polls settings, commands, clicks or health while idle.

- Standalone watches the configuration directory so atomic file replacements
  remain observable; successful writes also publish directly
- CDP context and disconnect events drive attachment and recovery
- The Steam panel subscribes to pushed settings and host state
- Explicit status requests probe responsiveness; stored connection state alone
  does not prove an idle renderer is responsive
- Millennium receives control requests through its backend config-change
  callback, then invokes the plugin's exported frontend handler
- Request-scoped file watchers receive correlated Millennium replies; expired
  requests and unloaded frontends cannot acknowledge execution

Millennium's config-change callback and frontend export invocation bypass the
main-world config subscription that missed updates in the isolated plugin.
The CLI transport owns its temporary config entry and reply directory. Stored
requests are never replayed at startup.

Timers remain for request deadlines, disconnected/startup retries, waiting for
a dialog to close, toast painting and click-triggered window creation. These
flows stop when completed or disposed; there is no recurring healthy-idle tick.
A dead transport cannot push its own failure into the panel. The next action or
status request detects that failure.

## The click path

At capture, `replay.ts` walks the toast's tree: find the first fiber
(`fiber.ts`), climb to the toast's HostPortal root (toasts are
portal-rendered from the main window's tree — rooting higher once swept 673
candidates), BFS downward collecting every function-valued
`onClick`/`onActivate`, and let `choose.ts` pick:

- **twin** — the deepest `onClick` that IS (`===`) an `onActivate` seen
  shallower. Steam drills the same handler object down the toast's wrapper
  chain, and only the DOM end pairs the activate with the toast-dismissal
  bookkeeping; invoking anything less leaked toast display slots until no
  toast rendered at all.
- **sole** — every candidate is one function object; nothing to mis-choose.
- **refuse** — ambiguous candidates are never invoked. A wrong invoke ACTS
  (a voice-chat accept answers the call). A separately verified catalog route
  can still handle the click; without one, the notification remains inert.

A clickable notification crosses the positional RPC's route argument as
`click:<base64url JSON>`. The helpers expose the same envelope to the OS as
`steam://steam-native-notifications/notification/<base64url-envelope>`. The version-1
envelope contains a cryptographically random 128-bit replay token, capture
surface appid (`0` for desktop), durable fallback or `null`, and the desktop
window family (`main` or `chat`) used for replay preparation and platform focus.
It contains no notification text or artwork.
Known Steam types use only observed catalog routes; known inert types remain
inert. A type absent from the catalog gets the neutral `steam://open/main`
fallback while its exact callback remains preferred.

Millennium marks its synthetic notification object with `millennium: true`.
An explicit, valid `data.activationUrl` is used when a future emitter supplies
one. Valid routes are bounded, whitespace/control-free lowercase `steam://`
URLs that fit the canonical click envelope. For current Millennium versions,
its registered route or any update title from its 20 active locales maps to
`steam://millennium/settings/updates`;
other Millennium toasts get only the neutral fallback. The localized display
copy always comes from Steam's painted DOM, never from this routing table. This
also avoids treating Millennium's placeholder type 12 as Steam's unrelated
`FamilySharingStopPlaying` notification.

`frontend/steamurl.ts` registers the `steam-native-notifications` URL section for the
whole Steam session and rejects malformed paths and envelopes. On a matching
live surface the dispatcher tries exact replay first. The stash binds the
capture surface to its closure, so changing the envelope cannot authorize a
different surface. Missing, malformed, or contradictory overlay discovery
refuses dispatch. On a surface mismatch, missing stash entry, replay throw,
or post-restart activation, it uses the durable fallback. A toast with neither
a proved handler nor a fallback is inert. Group chat has exact replay only: its
room dispatcher requires a toast's session-only browser context, with no
verified replacement after a restart. Desktop fallback awaits window creation
and Steam's dispatch result before requesting Windows focus; a failed dispatch
or window timeout does not request focus. Clicks arrive through the URL handler;
the legacy click-file input and its polling bridge have been removed.

The replay stash holds the latest 256 chosen closures for the Steam session;
it has no time expiry. The cap is a memory bound, not a click-lifetime policy.
The closures stay in CEF RAM and disappear at restart. The fallback data lives
in the notification URL, so an OS-retained actionable notification can route
without persisting a closure or a plugin route file.

### Host focus correction

- Query `GameHostFocus(appid)` at click time when Steam selects a running game
- Keep the `game` / `desktop` / `unknown` contract, input validation, and platform
  selection in `backend/game_focus.lua`; unsupported platforms load no Linux code
- Isolate Linux Gamescope ownership and surface selection in
  `backend/focus/gamescope.lua`
- Read window state in `backend/focus/wayland.lua` through Millennium's embedded
  LuaJIT and system `libwayland-client.so.0`; no game policy, Python, or helper process
- Bind version 1 of `zwlr_foreign_toplevel_manager_v1` on a separate connection
  with a 500ms event deadline; never activate a window through Wayland
- Override Steam with desktop only when one Gamescope process belongs to the
  selected app ID, one Gamescope window exists, and another window is active
- Return `unknown` on unavailable libraries/protocols, disconnected or stalled
  compositors, or ambiguous ownership; retain Steam's selection
- Keep the Linux correction scoped to nested Gamescope on compatible Wayland
  compositors; X11, GNOME, and KDE providers remain unsupported
- Share Windows ownership detection in `tools/game-focus.ps1`, called by thin
  Millennium and standalone adapters with a two-second deadline
- Corroborate Steam's process records with executable paths, creation times,
  and live ancestry under the selected Steam installation; reject conflicting
  overlay ownership and changes to foreground or process identity during discovery
- Run Windows probes only for clicks or explicit `--host-focus <appid>` developer
  commands; retain Steam's selection when the result is `unknown`

Future providers implement `query(appid)` and are selected by `game_focus.lua`.
Only the Wayland reader exposes window snapshots; native window identities and
protocol details do not cross the frontend RPC. Add another provider when its
platform behavior is verified, not an empty implementation or provider registry.

Desktop chat dispatch targets app ID 0 directly without opening the main Steam
window. Non-chat desktop replay prepares the main window only after checking
that the stashed handler belongs to the selected surface.

On Linux, a live FreeDesktop default action makes the detached helper run
`steam <canonical-url>` with the URL as one argv element. The notification
daemon controls the popup lifetime. When the daemon identifies itself as
Quickshell, the helper also sends `omarchy-exec-argv` containing the fixed
`steam`, URL pair; Quattro can store that vector in its history. Arbitrary
FreeDesktop daemons standardize the action identifier returned to the sender,
not a persistent executable command, so reboot-durable history clicks are
daemon-specific. The new Linux
path has offline coverage and runtime evidence for stored-argv replay and
Achievement fallback after Steam restart/cold start. Quattro history UI clicks
worked with Steam running and fully stopped in the earlier Millennium checks.
The standalone candidate additionally demonstrated a live-banner pointer click
and Steam focus, then stored-argv fallback after Steam restart. Shell/login
recovery remains untested. Evidence belongs to its tested host and build; see
`docs/platforms.md` and `docs/experiments/rt3-validation.md`.

### Log vocabulary

Health and safe policy summaries are always available. `verboseDiagnostics`
defaults false and gates lazy formatting of payloads, routes, callbacks and
exception details. The table includes the detailed forms available after opt-in.
A formatter or logging transport failure never interrupts delivery.

All in `~/.cache/steam-native-notifications/plugin.log` (the Linux runtime
directory; `docs/platforms.md` has the others), truncated at each backend
load (Millennium buffers a packed plugin's logger output away from Steam's
console log, so the backend mirrors every line there itself). The helper
appends there too when it refuses a platform:

| line | meaning |
|---|---|
| `from-toast <name> type=N (Name) source=...` | extraction worked; client payloads include schema-decoded named fields; unknown and Millennium sources are named explicitly |
| `from-toast <name> unknown: no attached notification` | decoding could not identify the toast; exact replay plus `steam://open/main` remain available |
| `toast <name> -> {...}` | delivered; reports replayability, fallback, and whether a click envelope was attached |
| `toast <name> -> {...} (suppressed: ... notifications off)` | the surface toggle left this toast to Steam |
| `replay: candidates <name> n=K stashed=onClick@D (twin\|sole)` | the walk found and proved a handler |
| `replay: candidates ... n=0 (no fiber key ...)` | the `__reactFiber` convention moved |
| `replay: candidates ... portal=miss` | the HostPortal boundary moved (walked the fallback root) |
| `replay: candidates ... stashed=none (ambiguous)` | no handler is provable; only a verified catalog fallback can act |
| `replay: candidate <name> #i ...` | per-candidate detail, logged only on anomaly and capped |
| `click-bridge: replay token=<prefix>` | matching-surface exact replay ran |
| `click-bridge: fallback <route>` | durable dispatch was attempted; later door/window failures can refuse it |
| `click-bridge: no verified fallback token=<prefix>` | replay was unavailable and no safe route exists |
| `steam-url: registered steam://steam-native-notifications/notification/<payload>` | the canonical activation handler attached |
| `steam-url: click token=<prefix>` | the OS activation URL decoded and entered dispatch |
| `replay: invoke <name> onClick@D age=Ns` then `-> returned without throwing` | the click ran |
| `replay: invoke ... -> no stash entry / THREW ...` | why exact replay did not run |
| `focus: raised kind=<main\|chat> ... target=...` | Windows pulsed the selected Steam window after dispatch |
| `platform: <linux\|macos\|windows> [flatpak: <id>] runtime: <dir>` | the backend's answer at load; `docs/platforms.md` |
| `unsupported platform: <os> delivery is not implemented, notification dropped` | the backend refused to spawn (macOS) |
| `notify-action: unsupported platform ...` / `notify-action: notify-send not found ...` | the helper refused before delivery |

Every reflective failure is fail-closed: the worst case is a notification
that arrives unclickable, never a missing notification and never a wrong
action.

### Known and accepted limits

- Exact handlers are frozen to their capture surface. The bridge checks before
  invoking and uses the durable catalog against current focus when it differs.
  Known notifications without a verified route still fail closed after a
  surface change or Steam restart. Types absent from the catalog open Steam
  generally instead.
- Windows focus is a reversible topmost pulse after a dispatched desktop click.
  The canonical URL VM pass verified history storage, exact replay, and
  Achievement restart/cold-start fallback through active-session protocol
  invocation. The final artifact repeated Achievement exact replay and
  post-restart fallback after the surface and dispatch-completion fixes. UI
  clicks and visual focus remain untested. Chat selection
  accepts the first visible titled `steamwebhelper` window other than `Steam`;
  another Steam dialog can match, so selecting the intended chat is unverified
  when several candidate windows exist. `ShellExperienceHost` can remain the
  keyboard focus owner. See `docs/platforms.md` for measured scope.
- Linux's standard action is live only while the daemon retains it and the
  waiting helper remains its action client. Quattro receives a fixed argv hint
  intended for actionable history. Other FreeDesktop histories may retain a
  row without retaining an executable action, including across a reboot.
- Steam updates can move the fiber conventions (`__reactFiber` keys,
  `memoizedProps`, HostPortal tag 4) or stop drilling the handler object;
  each failure names its layer in the `replay: candidates` line.

## Verified facts

- Steam attaches its decoded notification to the toast's React tree:
  `{ notificationID, rtCreated, eType, eSource, data, ... }`. Client-sourced
  (`eSource=1`), `data` is a Closure protobuf whose values sit positionally
  in `array`; server-sourced (`eSource=2`), a plain rollup
  `{ type, item, url }` whose `item.body_data` is JSON.
- **The React path is strictly better than the notification feed.** An
  incoming voice chat renders as `notificationtoasts_10000_desktop` and
  produces no `RegisterForNotifications` event at all.
- Toast artwork: `steamloopback.host/assets/<appid>/<file>` maps to
  `<steam>/appcache/librarycache/<appid>/<file>`, where `<steam>` is the
  directory the backend publishes from `millennium.steam_path()`
  (`~/.steam/steam` on native Linux, a link to `~/.local/share/Steam`) or
  the helper's per-platform guess (`docs/platforms.md`); friend avatars
  are public CDN URLs, fetched once and cached by notify-action. The fetch
  runs curl with `LD_LIBRARY_PATH`/`LD_PRELOAD` cleared — the helper inherits
  Steam's loader environment, whose pinned_libs_64 libcurl the system curl
  refuses.
- A file-backed icon is sent as a `file://` reference in the `image-path`
  hint (`-i` stays the themed fallback) so the daemon can copy it and the
  icon survives into notification history; a path through `-i` becomes
  in-process image-data that history rows lose. Every delivery also names
  `steam.desktop` in a `desktop-entry` hint for app identity (name, logo
  badge, per-app grouping on daemons that read it).
- FreeDesktop body actions must be named `default`. The Linux helper leaves the
  popup lifetime to the daemon and launches the canonical URL only after
  `notify-send` returns that action. Quickshell additionally receives Quattro's
  fixed argv history hint. Expiry does not synthesize an action.
- Frontend-backend RPC rides Millennium's `ffi` bridge with positional
  arguments (`Notify(title, body, image, route, ingame, suppressPopup)`); the retired
  `callable` transport could not order a multi-key object. A Lua string return
  has arrived both raw and JSON-quoted across transports — unwrap only what
  starts with a quote.
- Settings are per-key values in Millennium's config store (`usePluginConfig`
  in the panel, `pluginConfig`/`subscribePluginConfig` behind `settings()`);
  successful panel writes update the runtime snapshot immediately. CLI writes
  request one explicit reload through the push control channel and report
  whether the live frontend acknowledged it. No idle settings or command poll
  runs. Missing settings use defaults; obsolete development settings have no
  migration path.

## Testing methodology, which is easy to get wrong

- **`tools/capture` first, always.** A stale bundle is indistinguishable from
  a broken feature. A full Steam restart is required for ANY change, backend
  included (`steam -shutdown && sleep 15 && setsid uwsm-app -- gtk-launch
  steam.desktop`; relaunch again if it is not up — a launch while the old
  instance is dying is silently swallowed).
- **A Steam toast is only clickable while a Steam window has focus**, and a
  `steam://`-style navigation changes a page inside an existing window —
  watch the client, or a working click looks like nothing. Both produced
  wrong conclusions in this project's history.
- **`tools/fire`** needs the `devFire` developer toggle (visible with
  `devMode`; see `.claude/skills/live-verify`). No `dev-fire:` log line
  means the toggle is off or the bundle is stale; a `dev-fire:` line with no
  `from-toast` means one of Steam's own gates ate the toast: SystemUpdate
  allows each update type once a week (in-memory until restart), server
  types obey the user's notification preferences, Gift/TradeOffer/
  FriendInvite injections need a sender persona.
- **Never fire TestIncomingVoiceChat.** The fake call has no caller to hang
  up, never resolves, and wedges Steam's toast queue until restart —
  verified by A/B with zero clicks and zero invokes. Real calls resolve when
  the caller hangs up.
- Server-sourced types go through injection (`tools/fire --server <type>
  '<body-json>'`) into Steam's real `OnServerNotification` ingestion.
  Download completion is the only real-event self-service trigger:
  `steam steam://uninstall/1073390 && steam steam://install/1073390`.

## Dead ends: do not redo these

- **Invoking the bare outermost onActivate** — leaked a toast display slot
  per on-screen click; three clicks silenced every toast until restart.
- **Choosing the handler by source-text similarity** — replaced by function
  identity, which is exact and minification-proof.
- **Walking from the absolute fiber root** — sweeps the whole Steam UI
  (toasts are portals).
- **`OnRespondToClientNotification(id, true)`** as a universal replay
  primitive — only 2 of 45 messages carry a notificationid.
- **Reading the click target from the DOM** — no anchors, no href, no inline
  handlers; it is all React state.
- **Keeping the toast popup alive to dispatch a real DOM click later** —
  Steam owns the popup lifecycle and destroys it on its own schedule.
- **Relying only on Millennium config subscriptions**: external writes can land
  in the main IPC context while the plugin runs in an isolated world. Local
  panel writes publish their result; CLI writes explicitly request a reload
  without adding a timer or reading settings on idle ticks.
- **Compositor rules for hiding Steam's toast** — the plugin invokes Steam's
  native dismissal after capture and delivery acknowledgement.
- The routing catalog's own dead ends (external steam:// URLs into the
  overlay, instance objects as browserInfo, the appid-0 playtime ingestion)
  are recorded beside the current rules in `frontend/routes.ts` and
  `docs/steam-routing.md`.
