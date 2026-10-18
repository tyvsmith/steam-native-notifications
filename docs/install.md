# Install Steam Native Notifications

Use one integration at a time. Both provide the same notification settings;
standalone adds them to Steam's Notifications page, while Millennium provides
a plugin settings panel.

## Standalone (Linux)

For native Linux x64 Steam, including RT3, without Millennium. Requires
[Bun](https://bun.com) 1.4.3 or newer, a graphical desktop with a systemd user
session, `notify-send`, `gdbus` and `curl`. LuaJIT and libwayland-client enable
focus discovery; without them, some click destinations may be unavailable.
Windows x64 has a [preview install](windows-standalone.md).
macOS and Flatpak standalone installations are unsupported.

### Install

Download the [rolling pre-release](https://github.com/tyvsmith/steam-native-notifications/releases/tag/latest)
package and checksum, then install from a graphical terminal:

```sh
snn_release=https://github.com/tyvsmith/steam-native-notifications/releases/download/latest
curl -fLO "$snn_release/steam-native-notifications.tgz" &&
curl -fLO "$snn_release/steam-native-notifications.tgz.sha256" &&
sha256sum --check steam-native-notifications.tgz.sha256 &&
bun add --global --force --trust "$PWD/steam-native-notifications.tgz"
```

If the checksum differs, download both files again: the rolling release may have
changed between downloads. Do not install a package that fails verification.

The trusted install hook sets up the background service. If it cannot complete,
run `snn setup` from the desktop session. Use `snn setup --steam-dir /absolute/path/to/Steam`
if multiple Steam installations are found. Setup does not install missing OS
utilities or restart Steam.

Fully exit and reopen Steam, then run:

```sh
snn doctor
```

Open **Steam Settings → Notifications → Steam Native Notifications** and select
**Send test notification**. A healthy status alone does not prove a visible banner;
your OS may send notifications to history when Do Not Disturb is enabled.

Setup enables Steam's local CEF debugging endpoint to load the integration.
Keep it local: debugging access can control the logged-in Steam client.
See [connection details](experiments/rt3-standalone.md#steam-connection).

### Update

Repeat the download and install commands above, then fully restart Steam.
`--force` reinstalls rolling builds even when their package version is unchanged.
Preferences are preserved. Setup also preserves a stopped or disabled service;
check `snn status --json` if the integration does not return.

### Remove

1. In the Steam notification settings, select **Remove OS notification integration**
   and confirm. If Steam is unavailable, run `snn teardown` instead
2. Remove the package:

   ```sh
   bun remove --global @tyvsmith/steam-native-notifications
   ```

3. Restart Steam to finish unloading the integration

Removal immediately restores Steam's notification behavior. Preferences, logs,
cached artwork and the shared CEF debugging marker are kept. Bun's uninstall
hook is not reliable; removing only the package leaves integration entries behind.
See [cleanup details](standalone-release.md#remove).

## Millennium plugin

Requires [Millennium](https://steambrew.app) 3.5 or newer on a supported Steam
client. Native Linux is the primary platform; Windows support is experimental.
Linux requires `notify-send`, `curl`, `steam` and POSIX shell utilities. Windows
uses the built-in Windows PowerShell 5.1, not PowerShell 7.

### Install

1. Download [`me.tysmith.steam-native-notifications.star`](https://github.com/tyvsmith/steam-native-notifications/releases/download/latest/me.tysmith.steam-native-notifications.star)
   from the rolling pre-release
2. Copy it, keeping that filename, into Millennium's plugins directory:

   | Platform | Directory |
   | --- | --- |
   | Linux | `${XDG_DATA_HOME:-~/.local/share}/millennium/plugins/` |
   | Windows | `<Steam>\millennium\plugins\` (usually under `C:\Program Files (x86)\Steam`) |

   Create the directory if needed
3. Fully exit and reopen Steam, then enable **Steam Native Notifications** under
   Millennium → Plugins. Restart Steam again if enabling it does not load the panel
4. Open its settings and select **Send test notification**

### Update or remove

To update, replace the `.star` and fully restart Steam. Disabling and re-enabling
the plugin is not a substitute for a full restart with this packed format.

To remove, exit Steam and delete the `.star`. On Windows, first remove the
per-user notification registration from Windows PowerShell 5.1:

```powershell
& "$env:LOCALAPPDATA\steam-native-notifications\notify-action.ps1" -Teardown
```

Then reopen Steam. Settings and cached files are retained.

### Build from source

From a checkout with Bun installed:

```sh
bun install --frozen-lockfile
bun run build
```

**Building installs the plugin** into Millennium's plugins directory. Fully
restart Steam afterward. For development and validation without changing the live installation, see
[the standalone development guide](experiments/rt3-standalone.md#validation).

## Troubleshoot

- **No system notification:** check the master switch, selected delivery option,
  Steam's own notification settings and your OS notification history/Do Not Disturb
- **Standalone panel missing or stale after an update:** fully restart Steam, then
  run `snn --host standalone doctor` and `snn --host standalone status --json`
- **Millennium panel missing or stale:** confirm the plugin is enabled and fully
  restart Steam. From a checkout with Bun installed, run `bun tools/capture`
- **Clicks differ after Steam restarts:** only supported destinations have a
  durable fallback; see [notification types](notification-types.md)
- **Switching versions:** remove the standalone integration before enabling
  Millennium, or disable Millennium's plugin and restart Steam before standalone setup

For a bug report, include your OS, Steam client/runtime, integration version and
whether the test button delivered a notification. Standalone logs are normally at
`~/.local/state/steam-native-notifications/standalone.log`; Millennium logs are at
`~/.cache/steam-native-notifications/plugin.log` on Linux and
`%LOCALAPPDATA%\steam-native-notifications\plugin.log` on Windows. XDG overrides apply
on Linux. Inspect logs before sharing; earlier verbose sessions may contain
notification text or account identifiers. See [diagnostic commands](standalone-release.md#settings-and-diagnostics).
