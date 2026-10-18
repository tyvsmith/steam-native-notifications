# Standalone Bun package

The experimental standalone host runs on native Linux x64 Steam without
Millennium. RT3 has recorded live coverage; non-RT3 Steam also passed user
testing. Bun 1.4.3 or newer is required; CI tests 1.4.3. Windows, macOS and
Flatpak standalone hosts are unsupported.

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

In Steam Settings → Notifications, select **Remove OS notification integration**
and confirm. Then remove the package:

```sh
bun remove --global @tyvsmith/steam-native-notifications
```

Without Steam, run `snn teardown` before removing the package. Cleanup stops the
owned user service and removes owned service/autostart files and installation
state. Preferences, logs, cached artwork and the shared CEF marker remain.
Removal immediately restores Steam notification behavior in the running session.
Restart Steam to finish unloading the injected hooks. Teardown never deletes package files.

The package declares a guarded `preuninstall` hook, but Bun 1.4.3 does not invoke
it. Trusted local/global tests with tarballs and registry packages confirm this
for both `remove` and `uninstall`. Although [Bun's documentation](https://bun.com/docs/pm/lifecycle)
lists it, the [1.4.3 implementation](https://github.com/oven-sh/bun/blob/bun-v1.4.3/src/install/lockfile/Package/Scripts.rs#L22-L58)
recognizes only install and prepare hooks. Use the button or `snn teardown`;
removing only the package leaves integration entries behind.

## Settings and diagnostics

Steam Settings → Notifications → Steam Native Notifications is the standalone
settings UI. Millennium uses the same controls in its plugin settings panel.

The `snn` CLI selects the single available host. Specify `--host standalone` or
`--host millennium` when both are present, or when another host cannot be probed.
A timeout never silently redirects a configuration write to another host.
From a checkout, replace `snn` with `bun run snn`.

```sh
snn status --json
snn doctor
snn capture 8
snn sample
snn config get
snn config set devMode true
snn config set devFire true
snn dev fire TestDownloadComplete 1073390
snn dev replay inspect
snn dev fire --wishlist 1073390
snn config set devFire false
```

`devMode` reveals developer controls; `devFire` allows synthetic commands.
The fixed `sample` command uses normal presentation settings without developer
opt-in. Replay and server commands use the same developer gate as fire. Never
synthesize `TestIncomingVoiceChat`; the unresolved call can block Steam's queue.
Millennium CLI writes request one settings reload through the existing control
channel. Output distinguishes saved preferences from a confirmed live reload.
Neither host polls settings or commands while idle. Status requests check
frontend responsiveness on demand. If reload is
unconfirmed, reopen plugin settings or restart Steam. Raw `tools/mep` writes
depend on Millennium delivering its event; reopen settings if it does not.
Reopen an already-visible Millennium panel if its controls have not refreshed.

Repository `tools/fire` and `tools/capture` share the CLI dispatch, host options
and JSON output. `tools/fire --sample` equals `snn sample`; `snn dev fire` accepts
the existing `--replay`, `--server`, `--wishlist` and `--overlay-info` forms.
`tools/mep` remains a low-level Millennium protocol debugger.

For offline standalone recovery, use `snn --host standalone config get|set|reset`.
Use `--config /absolute/path/to/standalone.json` to select an explicit recovery
file. If `XDG_RUNTIME_DIR` is absent, use this explicit-file form rather than
assuming no daemon exists. Malformed JSON is preserved and writes fail with a repair message. Reset
preserves developer mode opt-in, other-platform preferences and unrelated keys.

Detailed diagnostics default off. Enable them briefly when investigating a
notification, then disable them:

```sh
snn config set verboseDiagnostics true
snn capture 20
snn config set verboseDiagnostics false
```

Opt-in logs can contain notification text, account identifiers, artwork URLs and
click routes. Disabling the option does not erase existing logs. Normal logs
retain health, policy and failure summaries without those payload details.

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

## Publish a release

Building and installing a tarball do not publish it. A numbered `v*` release
builds the `.star` and Bun tarball together, checks matching versions and uploads
both to GitHub. Release notes use reachable numbered tags and ignore the moving
`latest` tag; the first numbered release includes the available commit history.

The separate **Publish npm package** workflow is manual and defaults to dry run.
Run it from the numbered release tag. It downloads that release's tarball,
checks its checksum and metadata, and recomputes source identity from the tag
before allowing publication. Prereleases use npm's `next` tag; stable versions
use `latest`. No compilation or lifecycle setup runs during publication.

Before a real publication, establish ownership of
`@tyvsmith/steam-native-notifications` on npm and configure its trusted publisher
for this repository, `npm-publish.yml`, and the GitHub `npm` environment. The
workflow uses OIDC rather than a stored registry token. Account bootstrap and
publisher configuration are separate release-owner tasks; this repository does
not establish them. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

After a version is published, users can install it with
`bun add --global --trust @tyvsmith/steam-native-notifications`. Until then, use
the GitHub release tarball or a local build. Millennium store listing and AUR
packaging are separate distribution channels, not requirements of these artifacts.
