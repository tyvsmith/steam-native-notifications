Under Active Development

# steam-native-notifications

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
format). Every green push to `main` publishes the packed plugin under the
[`latest`](https://github.com/tyvsmith/steam-native-notifications/releases/tag/latest)
pre-release; drop
[`me.tysmith.steam-native-notifications.star`](https://github.com/tyvsmith/steam-native-notifications/releases/download/latest/me.tysmith.steam-native-notifications.star)
into Millennium's plugins directory (paths below) and restart Steam. There is
no numbered release yet. To build from a checkout instead you also need
[Bun](https://bun.com):

```sh
bun install
bun run build
```

Building **is** installing: starlight packs the plugin and writes it straight
into Millennium's plugins directory —
`${XDG_DATA_HOME:-~/.local/share}/millennium/plugins/` on Linux, and
`<Steam>\millennium\plugins\` on Windows (the Steam path comes from the
registry). Then restart Steam and enable **Steam Native Notifications** under
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

On Windows a history click captured in a game's overlay first asks a one-shot
probe whether that game still owns the foreground window; after alt-tab the
click routes to the desktop instead of the hidden overlay. The probe answers
unknown, and the click stays on Steam's own choice, whenever Steam's process
records and the foreground disagree ([#14](https://github.com/tyvsmith/steam-native-notifications/issues/14)).

The `tools/fire` test door ships off and appears only with `devMode` enabled
out of band. See `docs/architecture.md` for testing instructions.

## Diagnosing

```sh
tools/capture   # is the running .star current, did the hook attach,
                # what did the last notifications carry
                # (the dev tools run under bun; on Windows: bun tools/capture)
```

The plugin logs to `~/.cache/steam-native-notifications/plugin.log` on Linux and
`%LOCALAPPDATA%\steam-native-notifications\plugin.log` on Windows (truncated at
each backend load); Millennium's loader lines are in
`~/.steam/steam/logs/console-linux.txt` under `me.tysmith.steam-native-notifications`.
Every stage of a click logs one line, and every failure mode names itself —
the vocabulary table is in `docs/architecture.md`.
