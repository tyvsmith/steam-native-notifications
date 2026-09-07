# steam-native-notify

A Millennium plugin that mirrors Steam's in-client notification toasts to the
desktop notification daemon, keeping the artwork and the click. Toasts land
in your notification centre with everything else, and clicking one does
exactly what clicking Steam's own toast would — because it *is* Steam's own
click: at capture time the plugin stashes the click handler Steam attached to
the toast, and a click on the desktop notification re-runs it. There is no
per-type routing table to maintain; notification types Steam adds tomorrow
are clickable on day one.

`docs/architecture.md` is the full picture; `docs/notification-types.md`
lists every notification type and what Steam's click does for it.

## Why a plugin

Steam draws each toast as its own CEF window whose title is the only text
outside the process; the message exists only in that window's DOM. Compositor
rules, Steam's logs, and AT-SPI carry none of it, so the reader must run
inside Steam's UI.

## Install

Requires [Millennium](https://steambrew.app) >= v3.5 (the `.star` plugin
format) and [Bun](https://bun.com). There is no tagged release yet, so build
from a checkout:

```sh
bun install
bun run build
```

Building **is** installing: starlight packs the plugin and writes it straight
into Millennium's plugins directory —
`~/.local/share/millennium/plugins/` on Linux, and
`<Steam>\millennium\plugins\` on Windows (the Steam path comes from the
registry). Then restart Steam and enable **Steam Native Notify** under
Millennium > Plugins. After any rebuild, restart Steam fully: `plugin.restart`
and disable/enable leave the plugin stopped.

The packed `.star` is platform-independent, so it can also be built on one
machine and copied into the other's plugins directory — which is how the
Windows support was developed and tested.

Runtime dependencies: Linux needs `notify-send`, `curl`, `steam` and `sh`;
Windows needs only what it ships with (Windows PowerShell 5.1 — *not* pwsh 7,
which cannot use the WinRT notification APIs). The plugin registers its
Windows toast identity per-user at load, and
`notify-action.ps1 -Teardown` removes it.

## Settings

| Setting | Outside games | Inside games |
| --- | --- | --- |
| Show OS notifications | On | On |
| Show Steam notifications | Off | On |
| Save to Notification Center only (Windows) | Off | Off |

- control Steam and OS notifications independently in each section; both off
  suppresses both
- show Notification Center controls only on Windows when the section's OS
  notifications are enabled; hiding a control preserves its preference
- let Windows decide banner visibility through its notification settings,
  including Do Not Disturb, unless Notification Center only is enabled
- leave Linux banner and history policy to the notification daemon

Context follows where Steam renders the toast. Steam can keep using the game
overlay after alt-tab, so Inside games settings can still apply then. Native
notifications cannot capture events that Steam never renders.

When replacing Steam's toast, the plugin closes it after the backend
acknowledges launching native delivery. A rejected request leaves Steam's
toast visible; the acknowledgement does not confirm a displayed OS banner.

Windows history clicks can still target a hidden overlay while a game is
running; focus detection is tracked in [#14](https://github.com/tyvsmith/steam-native-notify/issues/14).

The `tools/fire` test door ships off and appears only with `devMode` enabled
out of band. See `docs/architecture.md` for testing instructions.

## Diagnosing

```sh
tools/capture   # is the running .star current, did the hook attach,
                # what did the last notifications carry
```

The plugin logs to `~/.cache/steam-native-notify/plugin.log` (truncated at
each backend load); Millennium's loader lines are in
`~/.steam/steam/logs/console-linux.txt` under `me.tysmith.steam-native-notify`.
Every stage of a click logs one line, and every failure mode names itself —
the vocabulary table is in `docs/architecture.md`.

## Compatibility and known gaps

- Linux with native Steam is the shipped target, with any FreeDesktop
  notification daemon that supports actions. Without action support the
  notification shows but the click does nothing. Flatpak and Snap Steam are
  not supported by Millennium itself; the plugin's paths already know the
  Flatpak layout, but nothing has run there. On macOS the backend loads,
  logs that delivery is not implemented, and delivers nothing.
- **Windows support is EXPERIMENTAL**, validated on real Windows 11 but not
  in wide use. Notifications work — WinRT toasts through a PowerShell helper,
  branded "Steam" with the artwork, persisting in the Action Center — and so
  do clicks: a click replays Steam's own handler and lands where Steam would.
  No vendored binaries; every registration is per-user and reversible. One
  documented limitation: the Steam window does not come to the foreground on
  a click — it updates behind whatever window has focus. Windows gives the
  right to raise a window only to the process it activates, that process is a
  short-lived `steam.exe` that forwards the URL and exits, and Steam's own
  `steam://` activation behaves identically. `docs/platforms.md` records what
  was tried and what would be needed. The
  in-game half is further limited by Focus Assist, which suppresses toasts
  during fullscreen games by default.
- The 64-bit SteamRT3 client does not work: Millennium installs and reports
  success there, but its hook does nothing
  ([Millennium #840](https://github.com/SteamClientHomebrew/Millennium/issues/840)).
- On Linux a notification is clickable only while its popup is up; the copy
  in the notification centre is inert. quickshell 1.2 expires the popup
  after about 8 seconds despite the no-timeout hint, which bounds the click
  window. On Windows the toast persists in the Action Center and a click
  there activates too, because Steam receives the click rather than a
  short-lived helper.
- The stashed click is frozen to the surface the toast rendered on: a
  notification captured while a game was focused, clicked after that game
  exits, does nothing. Clicks also expire 120 seconds after delivery and do
  not survive a Steam restart or full quit.
- A toast whose handler cannot be identified with proof stays unclickable by
  design — never the wrong action. Notification types whose Steam click does
  nothing are equally unclickable here: the plugin mirrors Steam, it does
  not invent.
- Some server-sent types (wishlist sales, comments, and others) never toast
  unless enabled under Steam Settings > Notifications. Steam suppresses them
  before this plugin sees anything.
