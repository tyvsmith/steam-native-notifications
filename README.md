# Steam Native Notifications

Send Steam notifications to your operating system, with artwork and click actions.
Choose where notifications go while playing and on the desktop. System notifications
follow your OS settings, including Do Not Disturb and notification history where supported.

**Pre-release.** Steam updates can affect either integration.

## Choose a version

| Version | Use it with | Install |
| --- | --- | --- |
| **Standalone** | Steam RT3 without Millennium; native Linux x64 only for now | [Bun package](docs/install.md#standalone-linux) |
| **Millennium plugin** | A Steam client supported by [Millennium](https://steambrew.app); Linux and experimental Windows support | [`.star` plugin](docs/install.md#millennium-plugin) |

RT3 means Steam's client runtime, not a game's compatibility tool. Standalone
has also passed testing on non-RT3 Linux Steam. Use only one integration at a time.
macOS and Flatpak Steam are unsupported. See [platform coverage](docs/platforms.md).

The [rolling pre-release](https://github.com/tyvsmith/steam-native-notifications/releases/tag/latest)
provides the Millennium `.star` and standalone [Bun package](docs/install.md#install)
with a SHA-256 checksum. Standalone Windows x64 is available as a
[preview](docs/windows-standalone.md); Linux x64 is the supported install.

## Configure notifications

- **Standalone:** Steam Settings → Notifications → Steam Native Notifications
- **Millennium:** Steam menu → Millennium → Plugins → ▾ → Configure (Millennium 3.6.2)

| Context | Default | Available choices |
| --- | --- | --- |
| In game | Steam + System | Steam only, System only, Steam + System, Off |
| On desktop | System only | Steam only, System only, Steam + System, Off |

Turn off **Enable Steam Native Notifications** to restore Steam's normal behavior
without losing your preferences. Use **Send test notification** to check delivery.

The context follows Steam's toast surface; Steam can still use its game overlay
after you alt-tab. Notifications must be enabled in Steam for the integration to
capture them. Linux notification history and retained click actions depend on your
notification daemon; retained actions are verified with Quickshell/Quattro.

## Install, update or remove

See the [installation guide](docs/install.md) for both versions. Standalone users
should remove the integration from Steam settings **before** uninstalling the Bun
package; Bun removal alone does not reliably clean up the background service.

## Get help or contribute

- [Troubleshoot delivery](docs/install.md#troubleshoot)
- [Standalone CLI, lifecycle and packaging](docs/standalone-release.md)
- [Platform support and limitations](docs/platforms.md)
- [Architecture](docs/architecture.md) and [notification types](docs/notification-types.md)
- [Develop standalone](docs/experiments/rt3-standalone.md) and [validation record](docs/experiments/rt3-validation.md)
- [Release roadmap](https://github.com/tyvsmith/steam-native-notifications/issues/30)
- [Report a problem](https://github.com/tyvsmith/steam-native-notifications/issues/new)
