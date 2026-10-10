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

Steam must expose its DevTools port. After saving your work and fully exiting
Steam, launch the experimental RT3 client yourself with:

```sh
STEAM_FORCE_CLIENT=steamrt64 steam -cef-enable-debugging -devtools-port 8080
curl --fail http://127.0.0.1:8080/json/list
bun standalone/daemon.ts --port 8080
```

The debugging switches remain present in the installed RT3 binaries, but this
branch has not verified that launch sequence against the live client. If the
endpoint is unavailable, the daemon logs the reason and retries. If port 8080
is occupied, use another port in both commands. Never run the daemon together
with the enabled Millennium notification plugin: they would capture twice.

CEF debugging is unauthenticated and can control the logged-in client. Steam
may also enable permissive remote origins. Check that the listener is loopback
only before opting in. The daemon itself uses loopback only and refuses
advertised remote WebSocket endpoints or redirected discovery requests. It
opens no server of its own.

## Settings and diagnostics

Settings default to `~/.config/steam-native-notifications/standalone.json`
(respects `XDG_CONFIG_HOME`; override with `--config FILE`). Create the file
if needed. It is reread every second; missing or invalid values use defaults.
Only the existing boolean settings are accepted. Unlike the plugin's default,
this experiment preserves Steam's desktop toast alongside the native copy.
After validating delivery, set `showSteamOutsideGame` to `false` to replace it.

```json
{
  "notifyOutsideGame": true,
  "notifyInGame": true,
  "showSteamOutsideGame": true,
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

`--steam-dir DIR` selects the client data directory used for identity lookup.
Artwork resolution keeps the helper's existing native Steam directory guesses.
A nonstandard Steam path may therefore lose game artwork in this experiment.

Developer commands remain off by default. With `devFire: true`, the daemon
consumes the existing cache `.dev-fire` file once, and the frontend runs its
existing test machinery. `tools/fire` still checks Millennium freshness and
is not a standalone entrypoint. Never synthesize `TestIncomingVoiceChat`:
it can wedge Steam's toast queue until restart.

For optional autostart, adapt `standalone/steam-native-notifications.service.example`
to your absolute Bun and checkout paths, then install it as a user service.
No service is installed by the build or daemon. Stop the daemon with Ctrl-C or
stop your service. Its injected frontend remains in Steam until Steam exits;
backend requests time out and failed delivery preserves Steam's popup. To
fully remove hooks or load a rebuilt bundle, exit Steam completely and launch
it again without the debugging switches. Remove any `.cef-enable-remote-debugging`
marker only if you enabled debugging that way yourself.

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

Live RT3 checks remain pending:

1. Confirm the actual RT3 process, loopback DevTools listener, shared target,
   successful injection, and both hook-registration log lines
2. Capture a real download completion; inspect localized copy and artwork
3. Click a native notification and verify exact replay plus visible focus
4. Restart Steam; verify daemon reconnection and a retained notification's
   durable fallback, then reload the UI and check for duplicate delivery
5. Test nested-Gamescope focus and a compositor reconnect
6. Confirm stopping the daemon leaves Steam notifications usable; fully exit
   Steam to remove injected hooks

Startup notifications before attachment can be missed. Delivery acknowledges
helper launch, not a visible banner. At most 64 helpers may wait for native
actions; excess deliveries preserve Steam. LuaJIT or compositor failures return
`unknown` and retain Steam's focus selection. Bundle updates require a full
Steam restart; daemon reconnects deliberately reuse an already-injected bundle
to avoid duplicate callbacks and broken pending requests. This is an
experimental implementation, not a claim of tested RT3 support.
