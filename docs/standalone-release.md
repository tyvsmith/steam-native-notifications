# Standalone Bun package

The experimental standalone host runs on native Linux x64 Steam RT3 without
Millennium. Bun 1.4.3 or newer is required; CI tests 1.4.3. Non-RT3 Steam,
Windows, macOS and Flatpak standalone support remain unverified or unsupported.

## Install and update

Build with `bun run build:release`. The output in `dist/releases/` is an npm
package tarball containing a prebuilt Bun CLI, injected frontend and delivery
helpers. It contains no Bun executable and needs no compilation at installation.
The package name is `@tyvsmith/steam-native-notifications`; registry publication
is a separate release operation, not a consequence of building it.

Install the local tarball from a graphical terminal:

```sh
bun add --global --trust /absolute/path/to/package.tgz
snn doctor
```

The trusted postinstall attempts desktop setup only when this package owns the
global `snn` command. Installing it as a project dependency skips desktop setup. If scripts are disabled or the
graphical session, Steam root or dependencies are unavailable, run `snn setup`
from the desktop session. Use `snn setup --steam-dir /absolute/path/to/Steam`
when discovery is ambiguous. Installation never starts or stops Steam.
A full Steam restart activates a newly created CEF marker or changed frontend.

Bun owns package files and the CLI link. Update by installing the desired new
package version with Bun. The setup hook refreshes integration while preserving
a stopped or disabled service. Status reports an older frontend still running
inside Steam. Installing a previous package version is the downgrade path;
there is no separate application package updater or retained release directory.

Required OS utilities are `notify-send`, `gdbus` and `curl` plus POSIX shell
utilities. LuaJIT and libwayland-client enable focus discovery; missing optional
focus dependencies leave focus unknown. Setup never downloads OS dependencies.

## Remove

```sh
snn teardown
bun remove --global @tyvsmith/steam-native-notifications
```

Bun 1.4.3 did not execute removal lifecycle scripts in an isolated trusted-global
package test. Teardown is therefore explicit. It stops the owned user service
and removes owned integration files, preserving preferences and the shared CEF
marker. Package files belong to Bun and are never deleted by teardown. Removing
only the package can leave service/autostart entries behind. Injected hooks
remain until Steam exits.

## Settings and diagnostics

- change preferences in Steam Settings → Notifications → Operating system notifications
- use `snn doctor`, `snn status` and `snn capture` for troubleshooting
- use `snn config get`, `snn config set KEY true` or `snn config reset` while Steam is unavailable
- select an explicit recovery file with `--config /absolute/path/to/standalone.json`
- repair malformed JSON in the reported file; config commands preserve it and refuse writes
- enable developer commands before `snn dev fire TestDownloadComplete 1073390`
- use `--json` for structured diagnostic output

Config recovery targets the connected daemon's configuration file, or the
standard offline path when no daemon is available. Reset preserves developer
mode opt-in, other-platform preferences and unrelated keys. Millennium retains
its own plugin settings panel and configuration store.

## Ownership and sessions

Setup registers a user systemd service and hidden XDG autostart entry using
absolute Bun and CLI paths. It manages integration only: no package copying,
CLI symlink creation or external settings application. Session startup imports
the current desktop environment; a disabled service remains disabled. One
graphical session per user is supported. `snn session` is an internal autostart
entry point; `snn recover` repairs an interrupted integration transaction.

Preferences use `$XDG_CONFIG_HOME/steam-native-notifications/standalone.json`.
Logs use `$XDG_STATE_HOME/steam-native-notifications/standalone.log`, with one
5 MiB backup. Unset or relative XDG paths use standard home-directory defaults.
The private control socket requires an owned absolute `XDG_RUNTIME_DIR`.

Old prerelease compiled installations have no automatic migration. Teardown of
that installation must use its original installer before configuring this one.
Distro packages should own their application files and depend on Bun; they must
not invoke a nested global Bun installation. AUR packaging is not included yet.

See [runtime and package notices](standalone-notices.md) and
[validation scope](experiments/rt3-validation.md).
