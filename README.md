Under Active Development

# steam-native-notifications

Mirror Steam notifications to the desktop, preserving artwork and click actions.
The Millennium plugin supports the existing client; an experimental standalone
host supports native Linux Steam without Millennium. RT3 has the recorded live
coverage; the non-RT3 client also passed user testing.

Clicks replay Steam's captured handler when its surface still matches. A
verified catalog fallback handles supported notifications after Steam restarts
or replay becomes unavailable. Ambiguous actions fail closed.

`docs/architecture.md` is the full picture; `docs/notification-types.md`
lists every notification type and what Steam's click does for it.

## Why a plugin

Steam draws each toast as its own CEF window whose title is the only text
outside the process; the message exists only in that window's DOM. Compositor
rules, Steam's logs, and AT-SPI carry none of it, so the reader must run
inside Steam's UI.

## Install

Requires [Millennium](https://steambrew.app) >= v3.5 (the `.star` plugin
format). Either install the packed plugin by hand or build it from a checkout.

### Manual install

Every green push to `main` publishes the packed plugin under the
[`latest`](https://github.com/tyvsmith/steam-native-notifications/releases/tag/latest)
pre-release. There is no numbered release yet.

1. Download
   [`me.tysmith.steam-native-notifications.star`](https://github.com/tyvsmith/steam-native-notifications/releases/download/latest/me.tysmith.steam-native-notifications.star).
2. Copy it, keeping that filename, into Millennium's plugins directory:
   - Linux: `${XDG_DATA_HOME:-~/.local/share}/millennium/plugins/`
   - Windows: `<Steam>\millennium\plugins\` (the Steam install directory,
     usually `C:\Program Files (x86)\Steam`)

   Create the directory if it does not exist.
3. Restart Steam fully (`steam -shutdown`, wait, relaunch). `plugin.restart`
   and disable/enable in Millennium leave the plugin stopped.
4. Enable **Steam Native Notifications** under Millennium > Plugins.

To update, replace the file and restart Steam the same way. To uninstall,
delete the file and restart; on Windows first run
`%LOCALAPPDATA%\steam-native-notifications\notify-action.ps1 -Teardown` to
drop the toast registration.

### Build from a checkout

Needs [Bun](https://bun.com) as well:

```sh
bun install
bun run build
```

Building **is** installing: starlight packs the plugin and writes it straight
into the plugins directory above (on Windows the Steam path comes from the
registry). Then restart Steam and enable the plugin as in the manual steps.
After any rebuild, restart Steam fully.

The packed `.star` is platform-independent, so it can also be built on one
machine and copied into the other's plugins directory — which is how the
Windows support was developed and tested.

Runtime dependencies: Linux needs `notify-send`, `curl`, `steam` and `sh`;
Windows needs only what it ships with (Windows PowerShell 5.1 — *not* pwsh 7,
which cannot use the WinRT notification APIs). The plugin registers its
Windows toast identity per-user at load, and
`notify-action.ps1 -Teardown` removes it.

## Settings

Standalone: open Steam Settings → Notifications → Operating system notifications at the
bottom of the page. Millennium: use the plugin settings panel.

| Setting | Outside games | Inside games |
| --- | --- | --- |
| Show OS notifications | On | On |
| Show Steam notifications | Off | On |
| Save to Notification Center only (Windows) | Off | Off |

- enable native notification integration by default; turning it off stops OS
  copies and preserves normal Steam notifications without changing the saved
  context preferences
- control Steam and OS notifications independently for each context; both off
  suppresses both while integration is enabled
- show Notification Center controls only on Windows when the section's OS
  notifications are enabled; hiding a control preserves its preference
- let Windows decide banner visibility through its notification settings,
  including Do Not Disturb, unless Notification Center only is enabled
- leave Linux banner and history policy to the notification daemon; live-banner
  actions use FreeDesktop notifications, while retained executable history
  actions are verified with Quickshell/Quattro only

Context follows where Steam renders the toast. Steam can keep using the game
overlay after alt-tab, so Inside games settings can still apply then. Native
notifications cannot capture events that Steam never renders.

When replacing Steam's toast, the plugin invokes Steam's native dismissal after
the backend acknowledges launching native delivery. A rejected request leaves Steam's
toast visible; unavailable native dismissal also preserves Steam. The
acknowledgement does not confirm a displayed OS banner.

Windows history clicks can still target a hidden overlay while a game is
running; focus detection is tracked in [#14](https://github.com/tyvsmith/steam-native-notifications/issues/14).

Developer commands ship off. Both hosts use the same CLI settings and test
commands; see [developer commands](docs/standalone-release.md#settings-and-diagnostics).
The fixed sample requires no developer opt-in.

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
Health and routing summaries remain enabled. Notification text, payloads, routes
and callback details require `verboseDiagnostics=true`. Existing logs may still
contain details from older builds or earlier opt-in sessions; inspect them
before sharing. See the vocabulary in `docs/architecture.md`.

## Experimental standalone client without Millennium

The experimental standalone host runs over Steam CEF DevTools on native Linux.
Build with `bun run build:standalone`; see
[setup and validation limits](docs/experiments/rt3-standalone.md).
Live standalone checks cover settings, visible synthetic banners, a banner
click and stored-history fallback after Steam restart. See the
[build-specific evidence and remaining merge gates](docs/experiments/rt3-validation.md).
Build a Bun package with `bun run build:release`; see
[installation and removal](docs/standalone-release.md). Bun is a runtime dependency;
settings live inside Steam. Registry publication is separate from local builds.
