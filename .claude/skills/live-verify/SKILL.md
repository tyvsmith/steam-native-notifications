---
name: live-verify
description: End-to-end runtime verification against the live Steam client — build, restart Steam, confirm the running bundle with tools/capture, fire test notifications with tools/fire, interpret the log. Use for "verify on the live client", "fire a test notification", "test this route in Steam", "did the change land", or after ANY frontend change.
---

Select the host explicitly and preserve settings. Use this Millennium procedure
only with an installed loader. For standalone, build a local release, upgrade
with `snn upgrade --release DIR`, then check `snn --host standalone status --json`
and `snn --host standalone capture`. Follow docs/experiments/rt3-validation.md
for the host-specific evidence gates. Never install or restart outside the
user-authorized scope.

All commands run from the repo root. Plugin log:
`~/.cache/steam-native-notifications/plugin.log` (mirrored by the backend, truncated
at each backend load); Millennium's loader lines are in
`~/.steam/steam/logs/console-linux.txt` under `me.tysmith.steam-native-notifications`.

## 1. Build, then full-restart Steam

```sh
bun run build
```

The build packs and installs `me.tysmith.steam-native-notifications.star` into
Millennium's plugins directory for the platform —
`${XDG_DATA_HOME:-~/.local/share}/millennium/plugins/` on Linux,
`<Steam install>\millennium\plugins\` on Windows,
`~/Library/Application Support/Millennium/plugins/` on macOS (starlight
`output_path = "auto"`); there is no separate install step.

**A full Steam restart is required for ANY change, backend included.** Under
the .star format `plugin.restart` and disable/enable leave the backend
STOPPED — the log shows "backend loaded" then "backend unloaded" immediately,
`tools/mep plugin.status name=me.tysmith.steam-native-notifications` reports
`running: false`, and `.dev-fire` sits unconsumed. Only a full Steam restart
recovers it. The frontend was already unreloadable ("Delegating frontend
load" logs and does not execute).

```sh
steam -shutdown && sleep 15 && setsid uwsm-app -- gtk-launch steam.desktop
sleep 20; pgrep -x steam >/dev/null || setsid uwsm-app -- gtk-launch steam.desktop
```

`steam -shutdown` returns before shutdown finishes; a launch while the old
instance is still dying pings it and exits **silently**. Hence the pgrep
re-launch — it has been needed twice in one session.

## 2. `tools/capture` first, always

```sh
tools/capture        # or: tools/capture 20  for more notification lines
```

A stale bundle is indistinguishable from a broken feature; never diagnose past
this step.

| capture says | meaning / next step |
|---|---|
| stale frontend identity | fully restart Steam within authorized scope, then repeat capture; toggling the plugin is insufficient |
| `loaded (never)` | enable the plugin in Millennium > Plugins |
| no `hook installed` in section 2 | bridge inactive — see the `steam-update-smoke` skill |
| section 3 empty | nothing captured yet — fire something (step 4) |

## 3. The tools/fire toggle

The dev poll is gated on **"Accept test commands from tools/fire"** in
Millennium > Plugins > Steam Native Notifications. Ships OFF. Flipping it in the UI
takes effect immediately, no restart.

Preset it externally (needs Steam running for the socket; `tools/mep` is a bun
script and speaks msgpack through `tools/lib/msgpack.ts`):

```sh
tools/mep plugin.config.get name=me.tysmith.steam-native-notifications key=devFire   # read current first
tools/mep plugin.config.set name=me.tysmith.steam-native-notifications key=devMode value=true
tools/mep plugin.config.set name=me.tysmith.steam-native-notifications key=devFire value=true
```

With Steam stopped, seed the same per-key values directly in
`~/.config/millennium/config.json` under
`plugins."me.tysmith.steam-native-notifications".config` (`"devFire": true`,
`"devMode": true`).

- Settings are per-key booleans in Millennium's config store (the earlier
  one-document form is obsolete). mep parses values as JSON, so
  `value=true` arrives as a boolean.
- A config write pushes to the running frontend: a mep write of `devFire`
  gates the poll within a tick, no restart (verified 2026-08-30).
- `devMode` gates the developer toggles in the panel (there is deliberately
  no UI for it); `devFire` gates the poll itself.
- `notifyInGame` OFF suppresses desktop delivery for overlay-context toasts:
  an in-game fire then logs `toast ... (suppressed: in-game notifications
  off)` and nothing reaches the daemon. `notifyOutsideGame` is the same gate
  for desktop-context toasts. Not a break.

## 4. Fire

Client types (Steam's own NotificationStore Test* methods; args are JSON
values — bare numbers and `null` pass through, quote strings):

```sh
tools/fire TestAchievement 570
tools/fire TestFriendOnline
tools/fire TestDownloadComplete 1073390
tools/fire TestSystemUpdate 1                # 1 = update available, 2 = restart required
tools/fire TestFriendMessage null '"Ready to play?"'
```

Also: `TestFriendIngame`, `TestFriendInviteRollup`,
`TestCloudSyncConflict/Failure`; search `strTest:` in the bundle for the
rest. **Never TestIncomingVoiceChat** — the fake call cannot resolve and
wedges Steam's toast queue until restart (docs/architecture.md).

Server (eSource=2) types — their shipped test methods are stubbed, so these
inject through Steam's real `OnServerNotification` ingestion:

```sh
tools/fire --server 2 '{"gifter_account":82140618}'       # Gift
tools/fire --server 9 '{"sender":"76561198257837083"}'    # TradeOffer
tools/fire --wishlist 1073390                             # Wishlist (appid must be known to the client)
```

body_data fields per type: `docs/steam-routing.md`, server catalog.
Current tools wait for a correlated execution receipt. Execution is distinct
from notification capture and visible delivery; an unacknowledged queue proves
neither.

A real download completion provides independent event evidence. Use a download
already authorized by the user; synthetic test methods do not prove real-event
ingestion. Do not uninstall a game merely to manufacture a test event.

Diagnostics (results land in the plugin log):

```sh
tools/fire --overlay-info                # dump the overlay browser map
tools/fire --replay inspect              # dump the stashed handler entries
tools/fire --replay invoke [toast-name]  # invoke a stashed handler, no click
```

## 5. Read the verdict (`tools/capture`, section 3)

| log signature | meaning |
|---|---|
| no `dev-fire:` line at all | toggle off (or stale bundle — step 2 first) |
| `dev-fire:` but no `from-toast` after it | a possible **Steam gate**; inspect capture and host errors before attributing it — see below |
| `dev-fire: NotificationStore.X is not a function` | wrong test method name |
| `dev-fire: server notification store not found` | bundle reshuffle — see `steam-update-smoke` |
| `from-toast ... type=N (Name) source=... fields=...` | extraction worked; check the fields |
| `toast ... -> {... replayable, fallback, click ...}` | captured replay/fallback envelope and presentation policy sent for delivery |
| `toast ... -> {...} (suppressed: ... notifications off)` | the surface toggle kept it off the desktop; not a break |
| `steam-url: click` then `click-bridge:` | accepted activation reached the bridge; inspect its outcome |
| `overlay: ... appid=N` | a surface door opened (chat room, screenshot, clip, media, playtime, web page) |

Click-path signatures beyond these (stale drops, door failures, the stashed
toast context): the vocabulary table in `docs/architecture.md`, "The click
architecture".

Known gates that swallow fires silently:

- **SystemUpdate**: same update type at most once a week; type 1 suppressed
  outright after a type 2. Both in-memory until Steam restarts.
- **Server types obey the user's notification preferences**
  (`CachedNotificationPreferences` in localconfig.vdf). On this machine
  Wishlist, Comment, Item, HelpRequest, PlaytestInvite have the toast bit OFF —
  enable in Steam Settings → Notifications or the fire never toasts.
- **Gift/TradeOffer need a sender persona loaded** (use a friend's account id);
  server FriendInvite needs the requestor's.

## 6. Click testing rules

- **A Steam toast is only clickable while a Steam window has focus.** Unfocused
  it takes no click at all. Any "Steam's toast does nothing" observation taken
  unfocused is meaningless (three wrong conclusions came from this).
- **Watch the client while clicking**: `steam://nav/...` changes a page inside
  the existing window; unwatched, a working navigation looks like nothing.
- Linux live actions launch `steam` with the canonical notification URL.
  Look for `steam-url: click` followed by `click-bridge:` and its outcome. The
  remaining click-file poll is a legacy/test seam.
- Quattro can retain the fixed `omarchy-exec-argv` action in history; other
  FreeDesktop daemons may not preserve executable actions. Test the actual
  daemon. Distinguish pointer clicks from direct stored-argv invocation.
- Replay keeps at most 256 handlers for the Steam session, with no time expiry.
  After Steam restarts, a supported durable fallback can still navigate.
  No safe replay or verified fallback means an inert click by design.
- Record the exact build, host, visible destination and focus separately from
  helper acknowledgement. Restore all temporary preferences after testing.
