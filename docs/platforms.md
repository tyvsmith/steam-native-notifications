# Platform support

Steam runs on Linux (native or Flatpak), macOS and Windows. This file is
where the plugin stands on each, what already branches per platform in the
code, and the plan for the platforms that do not deliver yet. Written to be
pasted into tracking issues. Every platform-specific claim carries a source
and a status: **verified** against a primary source (its own docs or code),
or **unverified**. Earlier Linux and Windows activation paths ran natively and
in a Windows 11 VM. The unified URL path ran on native Linux and in the Windows
VM; Quattro history clicks worked with Linux Steam running and fully stopped.
Windows UI clicks, visual focus, and a clean guest reboot remain untested, and
macOS has not run.

## Matrix

| platform | status | delivery | click |
|---|---|---|---|
| Linux, native Steam | **shipped**; Quattro history clicks observed with Steam running and fully stopped; live-banner and in-game clicks untested | `notify-send` to the FreeDesktop daemon | live `default` action launches the canonical Steam URL; Quickshell persists the fixed argv for exact replay or durable fallback |
| Linux, Flatpak Steam | paths ready; the host is unsupported by Millennium | same helper; inside the sandbox libnotify routes through the notification portal (plan) | canonical URL; portal action semantics unverified |
| macOS | backend paths ready; delivery refused, loudly | terminal-notifier `-execute` (plan) | `-execute` writes `.click` (plan) |
| Windows | **shipped**, EXPERIMENTAL; canonical history, FriendOnline/Achievement exact replay, and Achievement restart/cold-start fallback observed; UI clicks and visual focus untested | WinRT toast via notify-action.ps1 (Windows PowerShell 5.1, no vendored binary): branding, artwork, re-encode | canonical notification URL; exact replay or durable live-focus fallback, then one-shot route-aware focus |

Refused (macOS today) means: the backend loads, logs `desktop delivery is
not implemented on <platform>` at load and `unsupported platform: <platform>
delivery is not implemented, notification dropped` per toast, and `Notify`
answers `"unsupported"`. Nothing is delivered and nothing is silent.

**Shipped:** the frontend closes Steam's own toast only after `Notify`
answers `"ok"` (frontend/index.tsx), so a platform that cannot deliver -- or
a failed spawn anywhere -- leaves Steam's own toast alone instead of
swallowing the notification. Earlier Linux live checks covered the transport
before unification; the current-path measurements below define the tested scope.

## What differs per platform

The frontend runs inside Steam's CEF and is OS-blind. The Lua backend and the
helper are the whole surface. Everything file-shaped lives in one runtime
directory per platform, and everything the backend knows and the helper
needs crosses in files there, never as a sixth argument: the five positional
slots (`title body image route ingame`) are the contract on every platform.

| piece | Linux | Linux, inside Steam's Flatpak sandbox | macOS | Windows |
|---|---|---|---|---|
| detection | `package.config` first char `/`, no `jit.os == "OSX"` | as Linux, plus `FLATPAK_ID` set | `jit.os == "OSX"`, else the SystemVersion.plist probe | `package.config` first char `\` |
| runtime directory | `$XDG_CACHE_HOME/steam-native-notify` (`~/.cache/...`) | `$XDG_CACHE_HOME` is `~/.var/app/com.valvesoftware.Steam/cache` there, so `.../cache/steam-native-notify` | `~/Library/Caches/steam-native-notify` | `%LOCALAPPDATA%\steam-native-notify` |
| `millennium.steam_path()` | `~/.steam/steam/` | `~/.steam/steam/` (resolves inside the sandbox) | `~/Library/Application Support/Steam/Steam.AppBundle/Steam/Contents/MacOS` | `HKCU\Software\Valve\Steam\SteamPath` |
| Steam data guesses, after `steam_path()` | `~/.steam/steam`, `~/.local/share/Steam`, then `~/.var/app/com.valvesoftware.Steam/{.local/share/Steam,.steam/steam}` | the same list; `$HOME`-relative entries resolve through `--persist=.` | `~/Library/Application Support/Steam` | none: the registry is the only source |
| helper spawn | `sh <helper> ... >/dev/null 2>&1 &` | same | same call would work; refused until the helper has a macOS branch | `ffi` `CreateProcessW` with `CREATE_NO_WINDOW`, payload in a `<id>.notify` file |
| helper | `tools/notify-action` (POSIX sh, notify-send) | same, through the portal | Darwin branch of the same sh, terminal-notifier (plan) | `tools/notify-action.ps1` (WinRT toast), no vendored binary |
| desktop entry / app identity | `steam` | `com.valvesoftware.Steam` | the sending bundle's identity | registry-only AUMID under HKCU, icon extracted from the user's steam.exe |
| log | `<runtime>/plugin.log`; Millennium's loader lines in `~/.steam/steam/logs/console-linux.txt` | `<runtime>/plugin.log` in the per-app cache | `<runtime>/plugin.log` | `<runtime>\plugin.log` |
| dev tools | `tools/fire`, `tools/capture`, `tools/mep` | need a `--flatpak` path switch (plan) | need the macOS paths (plan) | `fire.ps1`, `capture.ps1` (plan) |

Files in the runtime directory: `plugin.log` (truncated at each backend
load; the helper appends its refusals there), the materialized helper
(`notify-action` on Linux; `notify-action.ps1` on Windows), `steam-dir` (one line: Millennium's `steam_path()` answer,
rewritten at each load, removed when there is no answer), `.dev-fire` and the
legacy/test-only `.click` input (consume-once handoffs), `icons/` (the helper's avatar cache),
and on Windows `<id>.notify` payload files (helper-consumed), `steam.ico`
(the extracted branding icon) and `.wpn-backoff` (the platform-wedge
back-off stamp). `tools/test-backend` loads the backend under Linux,
Windows (with and without a stubbed ffi) and macOS configurations, and
asserts every row above that the backend owns.

### How the platform is detected

- **Windows:** `package.config`'s first line is the directory separator, `\`
  on Windows and `/` elsewhere; LuaJIT sets it like PUC Lua. **Verified:**
  [Lua 5.2 manual](https://www.lua.org/manual/5.2/manual.html#pdf-package.config),
  [LuaJIT lib_package.c](https://github.com/LuaJIT/LuaJIT/blob/v2.1/src/lib_package.c).
- **macOS:** `jit.os` is `"OSX"`. `jit.os` "Contains the target OS name:
  "Windows", "Linux", "OSX", "BSD", "POSIX" or "Other"". **Verified:**
  [LuaJIT jit.* library](https://luajit.org/ext_jit.html). Millennium's Lua
  host is LuaJIT and calls `luaL_openlibs`, which opens the `jit` library
  (the JIT compiler itself is switched off by default; the table stays).
  **Verified:**
  [src/lua_host/main.cc](https://github.com/SteamClientHomebrew/Millennium/blob/main/src/lua_host/main.cc)
  (`#include <luajit.h>`, `luaL_openlibs(L)`, `luaJIT_setmode(... LUAJIT_MODE_OFF)`).
  **Unverified:** that the `jit` global reaches a plugin's `main.lua` on a
  macOS install; the backend falls back to opening
  `/System/Library/CoreServices/SystemVersion.plist`, which every macOS
  carries and no Linux does (a convention, not a documented contract:
  **unverified** as documentation, and untested because the test runner
  cannot create it). `tools/test-backend` plants a `jit` table for the macOS
  load. If both signals fail, the backend spawns the sh helper, which refuses
  on `uname -s` = `Darwin` with its own `plugin.log` line, so the failure is
  still loud.
- **Linux:** neither of the above. A BSD running Steam through Linux
  emulation reports as Linux, which is what its Steam is.
- **Flatpak sandbox:** flatpak sets `FLATPAK_ID` inside an app's sandbox
  (the per-app directory is `~/.var/app/$FLATPAK_ID`). **Verified:**
  [Sandbox Permissions](https://docs.flatpak.org/en/latest/sandbox-permissions.html).
  Logged in the load line (`platform: linux flatpak: com.valvesoftware.Steam
  runtime: ...`); the helper uses it for the desktop-entry name.
- Millennium's Lua API has no platform call; `millennium` exposes `ready`,
  `version`, `steam_path`, `get_install_path`, `call_frontend_method`,
  `cmp_version`, `is_plugin_enabled`, `config.*`, `assets.read`. `utils`
  carries arithmetic and time plus `getenv`/`setenv`, `exec`,
  `url_encode`/`hex_encode`/`base64_encode`, `uuid`, `hash` and file
  read/write helpers (`exec` is `_popen`-backed, which is why the Windows
  spawn does not use it). **Verified:**
  [src/lua_host/api/types/millennium.lua](https://github.com/SteamClientHomebrew/Millennium/blob/main/src/lua_host/api/types/millennium.lua),
  [utils.lua](https://github.com/SteamClientHomebrew/Millennium/blob/main/src/lua_host/api/types/utils.lua).
  `fs.join(...)` exists in the stubs
  ([fs.lua](https://github.com/SteamClientHomebrew/Millennium/blob/main/src/lua_host/api/types/fs.lua));
  the backend keeps a three-line join of its own so the paths exist before
  any module can fail and the offline tests run the same code.

### Where `steam_path()` points

`millennium.steam_path()` reads `HKCU\Software\Valve\Steam\SteamPath` on
Windows (forward slashes, e.g. `C:/Program Files (x86)/Steam`, with a
`C:/Program Files (x86)/Steam` default when the key is unreadable), returns
`$HOME/.steam/steam/` on Linux, and on macOS
`$HOME/Library/Application Support/Steam/Steam.AppBundle/Steam/Contents/MacOS`.
**Verified:**
[src/system/filesystem.cc](https://github.com/SteamClientHomebrew/Millennium/blob/main/src/system/filesystem.cc).
The docs warn the Steam path "is not guaranteed to be the path Millennium is
installed to" ([docs](https://docs.steambrew.app/plugins/lua/millennium)),
which is fine: the files wanted are Steam's. The macOS answer is the app
bundle, not the data directory, which is why the backend and the helper both
keep `~/Library/Application Support/Steam` as the next candidate.

## Linux, native Steam: shipped

Everything in `docs/architecture.md` describes this platform. Two layout
facts the candidate order rests on:

- Valve's bootstrap makes `~/.steam/steam` a symlink to the install
  directory, `~/.local/share/Steam` on most distributions. **Verified** on
  this machine (`~/.steam/steam -> /home/<user>/.local/share/Steam`,
  2026-08-30).
- Debian's `steam-installer` installs into `~/.steam/debian-installation`
  and symlinks `~/.steam/steam` to it (`STEAMDIR="$HOME/.steam/debian-installation"`,
  `ln -fns "$STEAMDIR" "$STEAMCONFIG/steam"`). **Verified:**
  [debian/scripts/steam.in](https://sources.debian.org/src/steam-installer/1:1.0.0.87~ds-3/debian/scripts/steam.in/).
  The helper used to hard-code `~/.local/share/Steam`, which finds no
  library cache on such a system; `~/.steam/steam` now leads the guesses,
  behind the `steam-dir` the backend publishes (the same path).

The one visible change from the per-platform work: a library-cache icon now
resolves through `~/.steam/steam/appcache/librarycache/...` (Millennium's
answer) rather than `~/.local/share/Steam/appcache/librarycache/...`. Same
file, and the daemon copies it or reads it in place either way.

The pre-unification click-file path was regression-tested on native Linux,
2026-09-05:

- current packed bundle, hook, identity, and URL templates after a full restart
- live FriendOnline and Achievement banner clicks through exact handler replay
- TradeOffer through Steam's server-notification ingestion and catalog decode
- synthetic post-restart `.click` envelope through the catalog fallback

The current helper converts a validated `click:<base64url-envelope>` route to
`steam://steam-native-notify/notification/<base64url-envelope>`. A live
`notify-send` default action launches `steam` with that URL as one argv element;
no Linux notification click writes `.click`. The notification daemon controls
the popup lifetime, and the helper stays detached. Live-action survival across
a Steam restart remains untested.

When `GetServerInformation` names Quickshell, the helper adds
`omarchy-exec-argv:["steam","<canonical-url>"]`. Quattro stores that fixed argv
vector with its history record. Other daemons receive only the standard
FreeDesktop action. That standard returns an action identifier to the waiting
client but does not define a persistent executable command, so arbitrary-daemon
history and reboot durability remain best effort. The argv has no shell
evaluation.

The unified URL path ran on native Linux with Quickshell 1.2, 2026-09-05:

- loaded the current packed artifact after each full Steam restart; the log
  recorded Linux platform selection, the materialized helper, hook attachment,
  URL templates, identity, and `steam-url: registered`
- persisted FriendOnline and Achievement as two-element `execArgv` vectors in
  Quattro history; executing each stored vector after its banner expired logged
  `steam-url: click`, `replay: invoke ... returned without throwing`, and
  `click-bridge: replay`
- executed a persisted Achievement vector after a full Steam restart; the
  activation logged `replay: invoke ... no stash entry`,
  `click-bridge: fallback steam://openurl/.../achievements/`, and the desktop
  dispatch line. Two initial invocations were delayed, then arrived together;
  the cold-start run below did not repeat that delay
- executed the same persisted Achievement vector with Steam fully stopped;
  Steam started, registered the URL section, accepted the queued activation,
  and dispatched the catalog fallback six seconds after invocation
- user-verified Quattro history clicks through the UI with Steam running and
  fully stopped, 2026-09-06; both opened their intended Steam destination

Still pending: clicking the live banner through the UI, explicit focus-owner
measurement, a shell/login restart, a host reboot, arbitrary FreeDesktop
daemons, and real in-game focus changes. The instrumented run executed
Quattro's persisted argv directly and did not synthesize mouse input; the later
history checks used the UI.

## Linux, Flatpak Steam: paths ready, host unsupported

### Status

Millennium: "We don't support Steam installed via Flatpak or Snap. We also
don't support any ARM based distributions". **Verified:**
[Installation](https://docs.steambrew.app/users/getting-started/installation).
Millennium hooks the Steam process, so a Millennium that supported Flatpak
Steam would run inside the sandbox, and so would this backend and its
helper. The code is ready for that shape; nothing has run in it.

### Sandbox facts

From Steam's Flathub manifest, **verified:**
[com.valvesoftware.Steam.yml](https://github.com/flathub/com.valvesoftware.Steam/blob/master/com.valvesoftware.Steam.yml):

- `--persist=.`: the whole home directory is persisted per app. Flatpak's
  rule: "A `--persist=.foo` bind mounts `~/.foo` inside the sandbox to
  `~/.var/app/$FLATPAK_ID/.foo` on host". Inside the sandbox `$HOME` keeps
  its name and `~/.local/share/Steam` works; on the host that directory is
  `~/.var/app/com.valvesoftware.Steam/.local/share/Steam`. **Verified:**
  [Sandbox Permissions](https://docs.flatpak.org/en/latest/sandbox-permissions.html).
- "Inside the sandbox `$XDG_CACHE_HOME`, `$XDG_CONFIG_HOME` and
  `$XDG_DATA_HOME` is set to `$HOME/.var/app/$FLATPAK_ID/{cache, config,
  data}` respectively" (same page). So the runtime directory lands in
  `~/.var/app/com.valvesoftware.Steam/cache/steam-native-notify` with no
  code change, and Millennium's plugin directory (`$XDG_DATA_HOME/millennium/plugins`,
  **verified:**
  [src/system/environment.cc](https://github.com/SteamClientHomebrew/Millennium/blob/main/src/system/environment.cc))
  would be `~/.var/app/com.valvesoftware.Steam/data/millennium/plugins`.
  **Unverified:** starlight's `output_path = "auto"` writing there.
- `--talk-name=org.freedesktop.Notifications`: the daemon's bus name is
  reachable directly from the sandbox. `--socket=wayland`, `--socket=x11`,
  `--share=ipc` are also granted.
- `rename-desktop-file: steam.desktop`: the exported desktop file is
  `com.valvesoftware.Steam.desktop`, so the `desktop-entry` hint must say
  `com.valvesoftware.Steam` there. The helper does when `FLATPAK_ID` is
  Steam's, or when the Steam directory it found is the per-app one.
- `--env=FLATPAK_STEAM_XDG_DIRS_PREFIX=~/.var/app/com.valvesoftware.Steam`
  and a `steam_wrapper` that manages the XDG directories: the wrapper's exact
  symlinking of `~/.steam` is **unverified**. The helper and the backend try
  the per-app `.local/share/Steam` before the per-app `.steam/steam`, because
  a `~/.steam/steam` symlink created inside the sandbox points at an
  absolute `/home/<user>/.local/share/Steam`, which resolves inside but may
  dangle on the host.

### How delivery would go inside the sandbox

libnotify 0.8.0: "Use Desktop Portal Notification when running confined
(snap and flatpak). Now the library acts like a wrapper in such scenario,
with some limited capabilities". **Verified:**
[libnotify NEWS](https://gitlab.gnome.org/GNOME/libnotify/-/blob/master/NEWS).
So `notify-send` inside the sandbox goes through
`org.freedesktop.portal.Notification`, whatever `--talk-name` grants, if the
runtime's libnotify is 0.8 or later. **Unverified:** the libnotify version in
`org.freedesktop.Platform 25.08`, the runtime the manifest pins.

The portal (version 2): `AddNotification(id, vardict)`, an `ActionInvoked`
signal, and a `default-action` "that will be activated when the user clicks
on the notification"; icons are themed names, a sealed memfd holding PNG,
JPEG or SVG, or (deprecated) bytes. **Verified:**
[org.freedesktop.portal.Notification](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Notification.html).
What that changes, all **unverified** until run:

- `-A default=Open` should map onto the portal's default action and
  `notify-send` should still print `default` on activation; the helper should
  then launch the canonical Steam URL as it does outside the sandbox
- the `image-path` hint (a `file://` path) is not a portal concept; the
  portal wants the icon serialized, and a sandbox path means nothing to the
  host. libnotify 0.8.x "Improve reading images when inside a portal" (same
  NEWS) suggests it converts; the history-row survival that motivated the
  hint (`docs/architecture.md`) needs re-measuring
- `-t 0` (no expiry) has no portal equivalent; the banner lifetime is the
  desktop's, so the click window is whatever the desktop allows
- the `desktop-entry` hint is redundant: the portal brands from the app id

### Validation needs

A Flatpak Steam with a Millennium build inside it. None exists. When one
does: expect `platform: linux flatpak: com.valvesoftware.Steam runtime:
/home/<user>/.var/app/com.valvesoftware.Steam/cache/steam-native-notify`,
then `helper:`, then a `toast ... ->` line for any Steam toast; then a
banner; then a click printing `default`. `tools/capture` needs a `--flatpak`
switch that reads the per-app cache and log paths.

### Risks and open questions

- Snap Steam is a third layout (`~/snap/steam/common/.local/share/Steam`,
  **unverified**) that nothing here guesses; Millennium does not support it
  either. Left out until someone asks.
- A Millennium that runs on the host and reaches into a Flatpak Steam is not
  a shape Millennium has; the host-side candidates exist for tooling and for
  a helper run by hand (`tools/notify-action --resolve-icon`).
- Does the portal deliver the `default` action back through `notify-send`'s
  stdout in the same form? If not, the helper needs a portal-aware branch.

## macOS: backend paths ready, delivery planned

### Status

Millennium carries a macOS bootstrap in its tree (`src/bootstrap/macos/`,
`src/platform/macos.cc`, `scripts/macos/install_macos.sh`). **Verified:**
[Millennium/src/bootstrap/macos](https://github.com/SteamClientHomebrew/Millennium/tree/main/src/bootstrap/macos).
Its README badges list Windows and Linux only and the installation docs have
Windows and Linux sections only. **Verified:**
[README](https://github.com/SteamClientHomebrew/Millennium#readme),
[Installation](https://docs.steambrew.app/users/getting-started/installation).
**Unverified:** that a released Millennium runs on macOS, and which Steam
build (`Steam.AppBundle` in `filesystem.cc`, `Steam.app/Contents/MacOS/steam_osx`
in `environment.cc`; the two files disagree on the bundle name).

What the backend does today on macOS: detects the platform, logs
`platform: macos runtime: /Users/<user>/Library/Caches/steam-native-notify`,
publishes `steam-dir`, reports delivery as not implemented, refuses each
toast with `unsupported platform: macos`, and answers `"unsupported"`.
`Identity` finds `loginusers.vdf` under `~/Library/Application Support/Steam/config/`.

### Paths

- Millennium on macOS: plugins under `~/Library/Application Support/Millennium/plugins`,
  config and data under `~/Library/Application Support`, logs under
  `~/Library/Logs`. **Verified:**
  [src/system/environment.cc](https://github.com/SteamClientHomebrew/Millennium/blob/main/src/system/environment.cc).
- Runtime directory `~/Library/Caches/steam-native-notify`: Apple's rule for
  `~/Library/Caches` is "app-specific support files that your app can
  re-create easily", and `Application Support` is for data the user would
  miss. Everything here is re-creatable (the helper is re-materialized at
  load; icons re-download). **Verified:**
  [File System Programming Guide](https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/FileSystemProgrammingGuide/FileSystemOverview/FileSystemOverview.html).
- Steam data at `~/Library/Application Support/Steam`: Millennium's own
  constant (the bundle lives under it; `environment.cc` above). That
  `config/loginusers.vdf` and `appcache/librarycache/<appid>/` sit beneath it
  as on Linux is **unverified** on hardware; the client is one codebase, so
  the layout is expected, not proven.

### Delivery options

Three tools, in order of fit. All **verified** from their READMEs unless
marked.

1. **terminal-notifier 3.x** (recommended).
   [julienXX/terminal-notifier](https://github.com/julienXX/terminal-notifier),
   3.1.0 released 2026-08-30, rebuilt on Apple's `UserNotifications`
   framework because `NSUserNotification` was deprecated in macOS 11;
   requires macOS 10.14 or later.
   - `-execute COMMAND` is stored with the notification and runs through
     `/bin/sh -c` when the notification is clicked, "in the graphical
     session's environment", even after terminal-notifier has exited. That
     is the click: a one-line command that writes `<epoch>|<route>` to
     `.click.<pid>` and moves it over `.click`. No blocking, no `-A`. The
     notification survives in Notification Center. The session-long bridge
     consumes a fresh write whenever the user clicks it; the envelope's
     catalog fallback survives a Steam restart if the OS preserves the action.
   - `-contentImage PATH` shows an image inside the notification: the game
     art or the avatar, resolved and cached exactly as on Linux.
   - `-appIcon` is gone: "macOS has no API to override a notification's
     icon. It always comes from the sending app's bundle". A custom icon is a
     custom copy of the app (`make icon ICON=... APP_NAME=...`), with its
     own bundle identifier and its own permission prompt. A copy named
     "Steam Notifications" with Steam's icon is the branding plan; the
     source icon (`Steam.app/Contents/Resources/*.icns`) is **unverified**.
   - `-action` waits and prints `@ACTIONCLICKED`, `@CLOSED`, `@TIMEOUT`
     (exit 6), the same shape as `notify-send --action`, if the `-execute`
     route proves unreliable.
   - Exit codes 3 (notifications not authorized), 4 (no GUI session), 5
     (service refused) name the failure for the log.
   - Banners auto-dismiss; keeping them until dismissed is the user's
     per-app alert style ("Alerts") in System Settings. The README says
     "macOS quarantines anything you download so the first run is blocked".
2. **alerter** ([vjeantet/alerter](https://github.com/vjeantet/alerter),
   v26.5, 2026-02-19, macOS 13 or later). Blocks and prints
   `@CONTENTCLICKED`, `@CLOSED`, `@TIMEOUT`, the exact `notify-send --wait`
   shape; `--app-icon` and `--content-image` go through a private API the
   README says "may break in future releases". Second choice.
3. **osascript `display notification`**: title, subtitle, sound name; no
   icon, no click callback. **Verified:**
   [Mac Automation Scripting Guide](https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/DisplayNotifications.html).
   Last resort, unclickable by construction; the plugin would rather refuse.

### Shape

```
backend/main.lua      spawn_helper: sh <helper> ... & (as on Linux; IS_MACOS
                      stops refusing once the helper has its branch)
tools/notify-action   Darwin branch after the seams: resolve the icon as now,
                      then <app>/Contents/MacOS/terminal-notifier
                        -title -message -contentImage <icon>
                        -execute '<absolute-path-to-a-tiny-click-writer> <route>'
                      no blocking, exit 0 on a delivered banner
frontend/clickbridge.ts   unchanged
```

Decisions:

- **One sh helper, one Darwin branch.** macOS has `sh`, `curl`, `find`,
  `sed`, `mv`, `date +%s`. `sha1sum` is GNU; macOS ships `shasum`
  (**unverified** that `sha1sum` is absent): the cache key falls back to
  `shasum` when `sha1sum` is missing. The `LD_LIBRARY_PATH` scrub is
  harmless there; whether Steam's macOS launcher sets `DYLD_*` variables that
  poison `curl` is **unverified** and is checked in validation step 2.
- **The click writer is a separate tiny script**, materialized next to the
  helper, because `-execute` runs later in another environment: absolute
  paths only, no dependence on the helper's variables.
- **Retry:** none needed. terminal-notifier reports "not authorized" (3) and
  "no GUI session" (4) as exit codes; log them.
- **Focus:** macOS Focus modes (including the automatic gaming one) hold
  banners in Notification Center. **Unverified** which conditions are on by
  default; the same limitation text as Windows applies, and the
  `-execute` click still works from Notification Center within the bridge's
  window.

### Packaging

- An app bundle is a directory of files with a signed Mach-O inside;
  `millennium.assets.read` returns one file at a time and `io.open` cannot
  set an executable bit, so materializing a bundle means several writes plus
  an `os.execute("chmod +x ...")`. Whether an ad-hoc signature survives
  being rewritten file by file, and whether files written by the Lua host
  get a quarantine attribute (they should not: quarantine is stamped by
  downloading apps), are both **unverified**.
- The alternative that avoids all of it: require `brew install
  terminal-notifier` (or the `.app` in `/Applications`), find it on `PATH`
  or in `/opt/homebrew/bin`, and refuse with `terminal-notifier not found`
  when absent. Loud, zero packaging risk, and the user answers the
  permission prompt once. Start there; bundle later if it matters.
- The branded copy (custom icon) has to be built on a Mac (`make icon`);
  commit it or build it in a macOS CI job (whoever owns `.github/`).

### Validation

A macOS tester, in order. Pass signals are in
`~/Library/Caches/steam-native-notify/plugin.log`.

1. **Groundwork (this branch).** Build, install under
   `~/Library/Application Support/Millennium/plugins`, enable, restart Steam.
   Expect `platform: macos runtime: /Users/...`, `desktop delivery is not
   implemented on macos`, a `steam-dir` file, then `hook installed` and a
   `toast <name> -> {...}` line for any Steam toast. That proves capture,
   replay stashing and the ffi bridge on macOS, and whether `jit.os` reached
   the plugin (add `type(jit)` to the load log for this step).
2. **Helper environment.** With the Darwin branch reduced to `curl` of an
   avatar URL: confirm the download works from Steam's child environment.
3. **Delivery.** `tools/fire TestFriendOnline` (the macOS `tools/fire` writes
   `.dev-fire` under `~/Library/Caches`): expect a banner from
   terminal-notifier, then `TestDownloadComplete 1073390` for library art
   through `-contentImage`, `TestFriendMessage` for a CDN avatar, and a
   body with quotes, backslashes and non-ASCII text.
4. **Click.** Click the banner: expect `click-bridge: replay token=...` and
   `replay: invoke ... returned without throwing`. Click the same notification
   in Notification Center later: expect exact replay during the session, or
   `click-bridge: fallback ...` after a Steam restart.
5. **Branding.** Swap in the "Steam Notifications" copy; expect the name and
   icon on the banner and a new permission prompt.
6. **Focus.** Turn on a Focus, fire: expect no banner, an entry in
   Notification Center, and whatever exit code the helper logs; record it
   here.
7. **Real event.** `steam://uninstall/1073390` then `steam://install/1073390`.

### Effort

| item | estimate |
|---|---|
| frontend: close Steam's toast only on `"ok"` -- shipped with the Windows branch | done |
| Darwin branch of `tools/notify-action`, click writer, `shasum` fallback | 1 d |
| `tools/fire` and `tools/capture` macOS paths | 0.5 d |
| branded terminal-notifier copy, or the Homebrew-only route | 0.5 to 1 d |
| validation pass, steps 1 to 7 | 1 d |

Three to four days with a Mac. Without one, only the first row.

### Open questions

- Does the `jit` global reach a plugin's Lua on Millennium's macOS build?
- Does Steam's macOS launcher set `DYLD_LIBRARY_PATH` or
  `DYLD_INSERT_LIBRARIES` for children, and does the system `curl` mind?
- Does a released Millennium run on macOS at all, and against which Steam
  bundle layout?
- Does `-execute` fire for a body click on a banner, or only from
  Notification Center? (The README says "when the notification is clicked".)

## Windows: shipped, unified activation VM-validated

The delivery, replay, fallback, history, cold-start, and focus mechanisms ran
in one dockur/windows Win11 Pro VM with Millennium 3.5.0-beta.2 and Steam before
the URL namespace changed. The current artifact registered and stored the
canonical URL in that VM. Programmatic active-session invocations verified
FriendOnline and Achievement exact replay plus Achievement fallback after an
unexpected VM/container power cycle and a full Steam stop. The narrow hardware
coverage keeps the platform experimental.

### Shape

    delivery
      backend writes <id>.notify JSON
      CreateProcessW(CREATE_NO_WINDOW)
        powershell.exe -File notify-action.ps1 -Id <id>
          read + delete payload
          resolve/re-encode artwork
          Show ToastGeneric with activationType="protocol"
          exit immediately

    banner or Notification Center click
      Windows launches
        steam://steam-native-notify/notification/<base64url-envelope>
      Steam dispatches the registered steam-native-notify section
        to frontend/steamurl.ts
      clickbridge.ts validates and routes:
        matching surface + live stash -> exact handler replay
        mismatch/restart/failure       -> durable fallback
      after successful desktop dispatch:
        backend starts notify-action.ps1 -FocusKind main|chat
      helper pulses the selected window topmost, restores z-order, exits

The envelope contains a random replay token, capture appid, durable fallback,
and focus kind. Known notifications use observed routes, Millennium updates use
Millennium's registered updates URL, and unknown types only open Steam. It
contains no notification content. The exact handler stash is
RAM-only, capped at 256, has no time expiry, and disappears with Steam. The
WinRT XML stores the complete fallback data in the protocol URL. Prior VM runs
showed that Windows retained the old protocol target in notification history;
the current pass confirmed canonical storage, same-session replay, persistence
across an unexpected VM/container power cycle, post-restart fallback, and
full-stop cold start. A clean planned guest reboot and UI history click remain
unverified.

No process waits for activation. The old 120-second helper retained about
32.8MB private memory per notification; the current one-shot focus helper only
exists for the post-click search and pulse. No custom COM activator, service,
binary, private URI scheme, or Start-menu shortcut is required.

### Setup

`notify-action.ps1 -Setup`, spawned at every load, idempotently registers
`HKCU\Software\Classes\AppUserModelId\me.tysmith.steam-native-notify` with the
display name and an icon extracted from the user's Steam executable. `-Setup`
also removes the obsolete private `snn:` registration. `-Teardown` removes the
AUMID key and icon. All changes are per-user.

Windows PowerShell 5.1 is required for WinRT projection; `pwsh` cannot provide
it. LuaJIT ffi is required for console-free `CreateProcessW`; without ffi the
backend logs the unsupported delivery and leaves Steam's toast intact.

### Pre-unification validation results

- delivery: branded Steam toast, friend avatar, library art, achievement art,
  UTF-8, and no console flash
- protocol: the former Steam URL activation reached the running frontend
- exact replay: FriendOnline and Achievement banner clicks invoked the chosen
  Steam handler
- route-aware focus: FriendOnline selected the named friend chat window;
  Achievement selected the main Steam window
- notification history: FriendOnline and Achievement rows worked after a full
  Steam restart; the friend click used the catalog fallback and raised the
  named friend chat
- cold start: clicking an Achievement history row with Steam fully stopped
  launched Steam and completed the persisted navigation after startup
- lifecycle: routed and unrouted delivery helpers exited after `Show()`; no
  activation callback or resident PowerShell process
- z-order: selected Steam window raised above an ordinary window and restored
  normal z-order

### Current unified validation results

The final artifact includes the surface and dispatch-completion corrections:
replay is bound to the stored capture surface, unknown current surfaces are
refused, the session-dependent group-chat fallback is absent, and desktop
dispatch completes before focus is requested. That artifact ran on native
Linux and in the Windows VM; the Windows checks below used active-session
protocol invocation rather than UI clicks.

- Windows PowerShell 5.1 source tests passed all eight helper assertions,
  including bounded canonical activation XML and one-shot process exit
- a full Steam restart logged backend load, AUMID setup, hook installation, and
  canonical `steam-native-notify` URL registration
- FriendOnline produced a canonical WinRT history URL; invoking it through the
  active user session logged exact handler replay
- Achievement produced a canonical WinRT history URL; a fresh active-session
  invocation logged exact handler replay
- the saved Achievement URI and its history row survived an unexpected
  VM/container power cycle; invoking it against the new Steam session logged no
  stash entry and dispatched the verified achievements fallback
- with `steam.exe` and `steamwebhelper.exe` fully stopped, the same canonical
  URL launched Steam and dispatched the fallback after registration
- the focus helper logged selection of the named friend chat plus a reversible
  topmost pulse, and main-window pulses for both Achievement fallbacks; no
  visual foreground result or UI click was measured
- after the final corrections, a fresh Achievement exact replay and
  post-restart fallback repeated on the final artifact; the focus log followed
  the desktop dispatch log
- a clean planned guest reboot remains untested; the persistence result came
  from the external VM/container power cycle

Chat selection currently accepts the first visible titled `steamwebhelper`
window whose title is not `Steam`. Other Steam dialogs can match; no verified
chat-specific discriminator is available in the current helper. Selection of
the intended chat with several candidate windows remains unverified.

Windows can still report `ShellExperienceHost` as the foreground owner after a
toast click. The pulse is a visibility guarantee above ordinary windows, not a
keyboard-focus guarantee. A topmost or exclusive-fullscreen game remains
unverified. Direct `SetForegroundWindow`, delayed retries,
`AllowSetForegroundWindow`, `AttachThreadInput`, `SwitchToThisWindow`,
`AppActivate`, and Steam's `BringToFront(AndForceOS)` did not take foreground
in the VM. See Microsoft's
[SetForegroundWindow restrictions](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow).

### Why Steam's URI scheme

Protocol activation is the documented path for unpackaged toast senders and
works from both banners and Notification Center without an activator. Steam
already owns `steam:` and forwards the registered `steam-native-notify` section
to the client JS.

An earlier private `snn:` scheme never launched from a Windows toast despite
working through `ShellExecute`. HKCU/HKLM registration, capability association,
opaque/authority forms, several handlers, action buttons, and reboot did not
change it; the same toasts launched `steam:`, `http:`, and `ms-settings:`.
The private scheme and JScript handler were removed.

### Remaining Windows work

- add an in-game presentation setting with three modes: Steam only, Steam plus
  a silent Notification Center copy (`SuppressPopup = true`), or a native
  banner; keep Steam's in-game toast in the first two modes and validate click
  dispatch with the game focused and unfocused
- `fire.ps1` / `capture.ps1` tester tooling
- `scenario="urgent"` opt-in for Focus Assist bypass
- `-Teardown` validation
- wider Windows, Steam, and Millennium coverage
