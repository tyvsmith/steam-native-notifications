# Run native notifications on the RT3 client without Millennium

Experimental Linux host for the 64-bit Steam client (`steamrt64`, also called
`steamrt3c` by Steam's launcher). This means the client runtime, not choosing
Steam Linux Runtime 3 as a game's compatibility tool.

The Bun daemon connects to Steam's CEF DevTools protocol, injects the shared
notification frontend into the default Steam UI context, and handles backend
calls through `Runtime.addBinding`. The existing Linux helper runs on the host,
where `notify-send`, `gdbus`, artwork files, and Wayland are available. Capture,
localized text, replay tokens, routing, and canonical Steam URL activation use
the same frontend as the Millennium plugin.

## Build and start

Requires native Linux Steam, Bun >=1.4.3 (the standalone build was tested with 1.4.3), `notify-send` (libnotify), `gdbus`
(GLib), `curl`, and optionally LuaJIT plus libwayland-client for the existing
nested-Gamescope focus correction. Flatpak, Windows, and macOS standalone
hosting are outside this experiment. Existing Millennium support is retained.

```sh
bun install --frozen-lockfile
bun run build:standalone
bun run test:standalone
```

`build:standalone` writes `dist/standalone/frontend.js` inside the checkout.
It does not install a `.star`, enable a service, edit Steam, or restart it.
Keep the checkout: the daemon reads the bundle and the existing helper there.

## Persistent setup and normal Steam launch

From a terminal in your logged-in desktop session:

```sh
bun standalone/setup.ts install
bun standalone/setup.ts status
# For an unusual native installation:
bun standalone/setup.ts install --steam-dir /absolute/native/Steam
```

Setup discovers and canonicalizes `~/.steam/steam`, `~/.steam/root`,
`${XDG_DATA_HOME:-~/.local/share}/Steam`, the conventional fallback, and
`~/.steam/debian-installation`. Distinct installations require `--steam-dir`.
It validates native client files and refuses Flatpak roots. It exclusively
creates an empty `.cef-enable-remote-debugging` in that root if absent. It never
edits Steam launchers/binaries or manages `.steam-enable-steamrt64-client`.
RT3 must already be selected by Steam's existing configuration.

After enabling a missing marker, fully exit and launch Steam yourself when
convenient. Setup never shuts down, kills, launches or restarts Steam. Start
Steam normally from its usual launcher, or simply:

```sh
steam
```

On October 10, 2026, marker-based plain `steam` launch was verified locally
against native RT3 build 1791592380: no `STEAM_FORCE_CLIENT`, no flags;
`steamrt64/steam -srt-logger-opened`, a `steamwebhelper` listener on
`127.0.0.1:8080`, SharedJSContext, hook installation and URL registration.
A download test subsequently delivered a fresh native notification with
`sendNative:true` / `showSteam:false`. This was a synthetic download test,
not real download completion. The existing RT3 selection marker was left alone.

Primary implementation evidence: [Decky's installer creates the empty marker
in the Steam root](https://github.com/SteamDeckHomebrew/decky-installer/blob/main/cli/install_release.sh);
[Decky's injector uses localhost port 8080](https://github.com/SteamDeckHomebrew/decky-loader/blob/75563316f9119ee7e36be7f43885be65e877fad0/backend/decky_loader/injector.py).
These upstream sources establish the marker convention; the native RT3 behavior
above comes from the separate local observation, not a Valve API guarantee.
The marker is an existence toggle, not a port configuration file. Persistent
setup therefore uses **8080 only**. If occupied by another process, setup
refuses and status tells you to inspect `ss -ltnp 'sport = :8080'` and resolve
the conflict yourself. No unverified persistent custom-port mechanism is used.
The foreground daemon retains `--port` for explicitly managed developer launches;
that option does not configure Steam or the marker.

Setup installs `steam-native-notifications-standalone.service` under
`$XDG_CONFIG_HOME/systemd/user`, enabled for `graphical-session.target`, plus
an XDG desktop autostart entry. The latter imports the **current** display,
Wayland, D-Bus, runtime directory and session PATH into the user manager and
restarts only this daemon at login. No display/socket names are hardcoded.
Installation performs that same environment import from your desktop terminal.
The service uses absolute Bun/checkout/config/Steam paths, explicit XDG roots,
and the built `dist/standalone/frontend.js` plus helper/focus assets in the
checkout. Keep both the checkout and Bun at these paths: this experimental
release is **source-backed runtime installation, not a relocatable distributable**.
Build before install; rebuilds do not install Millennium.

Install is idempotent and journals file ownership in
`${XDG_STATE_HOME:-~/.local/state}/steam-native-notifications/standalone-install.json`.
Preexisting marker and settings stay byte-for-byte unchanged, including developer
opt-ins. Changed/preexisting service files are refused rather than overwritten.
A failed service activation leaves the recorded setup available for retry or
uninstall; it does not restart Steam or delete shared debugging. Rerun install
after fixing the reported issue. An interrupted installer lock is reported with
manual recovery instructions. Changing the runtime checkout/Bun/Steam path
requires uninstalling the existing setup first.

Stop any old detached standalone daemon before installing. Setup detects
unmanaged `standalone/daemon.ts` processes and refuses activation; it never
kills them. New daemons hold a kernel lock in the shared cache directory,
so manual and service launches using the same XDG cache cannot both attach.
The lock automatically releases on exit/crash; deliberately using different
cache roots defeats that guard and is unsupported. Never run this daemon with
the enabled Millennium notification plugin: both capture the same toasts.

Status is read-only apart from transient CDP connections. It distinguishes
missing marker/build/dependencies/service, absent endpoint, non-loopback or
non-Steam listener, missing/ambiguous Steam target, and daemon readiness.
The daemon publishes a fresh heartbeat only after a live CEF binding/backend
`Health` RPC roundtrip. Status additionally probes the current default context.
This works with the already-injected baseline bundle, without another Steam
restart, and is not inferred from stale logs. It proves attachment and responsive
backend/bridge, **not independently that popup/URL registrations or visible
notification delivery succeeded**; use the hook/URL log evidence and an actual
notification for those checks. An unavailable `/proc` ownership inspection
fails closed. DND can save/dismiss a notification despite healthy delivery.

CEF debugging is unauthenticated and can control the logged-in client. Steam
may also enable permissive remote origins. Check that the listener is loopback
only before opting in. The daemon itself uses loopback only and refuses
advertised remote WebSocket endpoints or redirected discovery requests. It
opens no server of its own.

## Settings and diagnostics

Settings default to `~/.config/steam-native-notifications/standalone.json`
(respects `XDG_CONFIG_HOME`; override with `--config FILE`). Create the file
if needed. It is reread every second; missing or invalid values use defaults.
Only the existing boolean settings are accepted. Newly configured defaults
replace desktop Steam toasts with native notifications (`showSteamOutsideGame`
is `false`), while retaining the existing in-game defaults (native delivery and
Steam visibility both enabled). Developer commands remain opt-in. Installation
preserves an existing configuration; it never resets preferences.

```json
{
  "notifyOutsideGame": true,
  "notifyInGame": true,
  "showSteamOutsideGame": false,
  "showSteamInGame": true,
  "devMode": false,
  "devFire": false
}
```

The in-Steam settings panel and Millennium external protocol (MEP) are absent.
`tools/mep` and the existing `tools/capture` freshness verdict describe the
Millennium host, not this daemon. Read
`~/.cache/steam-native-notifications/standalone.log` for standalone attachment,
`hook installed`, and `steam-url: registered` evidence. The existing delivery
helper still writes failures to `plugin.log`. Both paths respect
`XDG_CACHE_HOME`. Logs may contain notification text; keep them private.

`--steam-dir DIR` selects the canonical native client root for identity and
artwork lookup. The standalone helper receives this root explicitly without
overwriting Millennium's shared `steam-dir` cache file.

Developer commands remain off by default. With `devFire: true`, the daemon
consumes the existing cache `.dev-fire` file once, and the frontend runs its
existing test machinery. `tools/fire` still checks Millennium freshness and
is not a standalone entrypoint. Never synthesize `TestIncomingVoiceChat`:
it can wedge Steam's toast queue until restart.

## Stop or uninstall

```sh
systemctl --user stop steam-native-notifications-standalone.service
bun standalone/setup.ts uninstall
# Explicitly remove our marker only if still unchanged and created by this setup:
bun standalone/setup.ts uninstall --remove-owned-marker
```

Uninstall stops/disables only the unchanged owned user service, removes owned
unchanged service/autostart/settings files, and preserves modified preferences,
preexisting files, and all unrelated settings. Marker removal is **opt-in even
when owned**, because another debugging consumer may now depend on it. A
preexisting or replaced/modified marker is never removed, even with that flag.
Choose the marker-removal flag on the uninstall invocation; once the ownership
journal is removed, remaining marker/settings files are treated as preexisting
on a later install. Uninstall does not unload CEF hooks: those remain until
Steam exits. With the backend stopped, requests time out and failed delivery
preserves Steam's popup. A later voluntary Steam restart removes hooks or loads
a rebuilt bundle. Keeping a shared marker retains debugging after restart.

## Evidence and remaining checks

The installed Steam launcher selects `steamrt64/steam` when the RT3 marker is
present and identifies the replaced runtime as `steamrt3c`. Installed UI code
still contains `g_PopupManager`, `RegisterForRunSteamURL`, and
`webpackChunksteamui`. These source observations establish the intended seams,
not successful notification delivery.

Target titles and UI URL patterns follow
[Decky's current injector](https://github.com/SteamDeckHomebrew/decky-loader/blob/75563316f9119ee7e36be7f43885be65e877fad0/backend/decky_loader/injector.py).
The host additionally requires the default context to expose both
`g_PopupManager` and `SteamClient`. Explicit shared-context titles take priority over main UI pages. Remaining
candidates are probed; if several shared contexts are ready, it refuses to
choose. The installed webpack runtime hides its module cache; the adapter
resolves only factories containing the two known store signatures, rather than
eagerly loading every module. Steam can change these private interfaces.

Offline checks cover the real compiled frontend's capture and URL registration,
localization/artwork forwarding, failed delivery preserving Steam, repeated
injection, settings, identity, method validation, socket correlation/errors,
context isolation, and reload reinjection. Existing backend, route, click,
platform, and Wayland fixtures still apply. CI builds both hosts and verifies
the Millennium `.star` without installing it.

Live Linux RT3 checks on October 10, 2026 (client build 1791592380):

- Confirmed the 64-bit client, loopback-only CEF listener, SharedJSContext,
  both hook registrations, and no Millennium globals in that context.
- Captured genuine friend-online events. Steam's built-in achievement and
  download test methods also reached the native desktop server; game artwork
  appeared on the visible download banner. A real download was not performed.
- Invoked the visible download banner's default action through Omarchy's
  notification IPC (the same handler as its UI click). The canonical URL
  reached the standalone bridge, replayed the captured callback, and visibly
  opened the correct Library page. A subsequent physical mouse click on a
  separately generated banner also replayed Steam's callback and opened the
  same page. The existing neutral terminal was active immediately before the
  click; Steam became active afterward (confirmed by compositor state).
- Restarted the daemon without repeating hook registration, reloaded the
  shared UI with automatic reinjection, then restarted Steam with automatic
  reattachment. A fresh post-restart test produced one delivery request.
- Executed a retained native-history download action after UI reload and
  full Steam restart. Its expired replay token used the durable Library URL.
- The desktop initially had Do Not Disturb enabled: notifications were saved
  to history and immediately dismissed. Temporarily disabling it verified
  the visible banner; the original enabled setting was restored afterward.
- Stopped the experimental daemon and monitor, exited the debugging session,
  and relaunched Steam normally to remove injected hooks and the debug port.

Remaining live checks: real download completion/localized copy, physical
retained-history clicks, in-game capture,
nested-Gamescope focus, compositor reconnect, and delivery failure while the
daemon is stopped. No game installation or user service was changed. Private
notification text, IDs, logs, and desktop screenshots are not published here.

Startup notifications before attachment can be missed. Delivery acknowledges
helper launch, not a visible banner. At most 64 helpers may wait for native
actions; excess deliveries preserve Steam. LuaJIT or compositor failures return
`unknown` and retain Steam's focus selection. Bundle updates require a full
Steam restart; daemon reconnects deliberately reuse an already-injected bundle
to avoid duplicate callbacks and broken pending requests. This is an
experimental implementation with limited live desktop RT3 validation.
