# Develop the standalone RT3 host

The native Linux host supports Steam's 64-bit client (`steamrt64` / `steamrt3c`)
without Millennium. This is the client runtime, not a game's compatibility tool.
Capture, localized text, presentation, replay, durable routing and the Linux
notification helper are shared with the Millennium plugin.

Use the [packaged installer](../standalone-release.md) for installation. The
compiled package includes its runtime; development requires Bun 1.4.3.
There is one CLI and one package installer. Source installations and migration
from earlier pre-release package formats are unsupported.

## Build and run

```sh
bun install --frozen-lockfile
bun run build:standalone
bun run test:standalone
bun run snn --help
bun run build:release
```

Builds write into `dist` without installing either host. Install the extracted
release with its `snn install --release DIR`. For foreground debugging against
an already configured Steam client, stop the packaged service first, then run:

```sh
bun run snn daemon --steam-dir /absolute/native/Steam
```

The foreground daemon uses the checkout's built bundle and helper assets.
Do not run both hosts or two daemons against the same client. The kernel lock
prevents duplicate daemons using the same cache root and releases on exit.
Different cache roots bypass that guard and are unsupported.

## Steam connection

The installer discovers native Steam roots, canonicalizes symlinks and requires
`--steam-dir` when multiple installations exist. Flatpak is unsupported.
It creates `.cef-enable-remote-debugging` if absent, without changing launchers,
binaries or RT3 selection. A full Steam restart activates a new marker or bundle.
The package commands manage only their own service; they do not restart Steam.

Persistent debugging uses port 8080. Foreground `--port` selects an existing
explicitly configured endpoint; it does not configure Steam. CEF debugging is
unauthenticated and controls the logged-in client. The daemon verifies listener
ownership, requires loopback endpoints and refuses redirected discovery.

The adapter selects a default context exposing `g_PopupManager` and
`SteamClient`, preferring SharedJSContext and refusing ambiguous candidates.
These are private Steam interfaces and can change. Reconnection reuses a loaded
frontend to preserve callbacks; status reports mismatched build identities.

## Settings and diagnostics

- use the Native Notifications page at the bottom of Steam Settings
- use `snn settings` for the external editor, including while Steam is stopped
- use `snn --host standalone status --json`, `doctor` and `capture`
- enable `devFire` before `snn --host standalone dev fire TestDownloadComplete 1073390`
- never synthesize `TestIncomingVoiceChat`; it can wedge Steam's toast queue

Preferences use `$XDG_CONFIG_HOME/steam-native-notifications/standalone.json`,
with normal XDG defaults. The fixed sample button requires no developer opt-in.
Status uses the private user socket and live frontend health. Healthy transport
and helper acknowledgement do not prove visible notification delivery.

Logs use `$XDG_STATE_HOME/steam-native-notifications/standalone.log`, with one
5 MiB backup. They contain notification text and remain private. Required
native delivery dependencies are `notify-send`, `gdbus` and `curl`. LuaJIT and
libwayland-client enable focus discovery; unavailable focus stays unknown.

## Validation

Run the shared regression suite and pack Millennium without installation:

```sh
bun run test
bunx starlight pack -o dist
bun tools/test-packaged.ts
```

Build the release before the compiled-package smoke test. It runs with isolated
paths, fake Steam/systemctl and no Bun on PATH. Fixtures prove package behavior,
not live Steam compatibility. See [recorded live evidence and remaining
checks](rt3-validation.md). Windows, macOS and Flatpak standalone hosts remain
unsupported. Public binary distribution still requires the runtime licensing
materials listed in [notices](../standalone-notices.md).
