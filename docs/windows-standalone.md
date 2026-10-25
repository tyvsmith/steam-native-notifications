# Windows standalone preview

Preview support for native Windows x64 Steam without Millennium. The same Bun
package contains both Linux and Windows support. Do not enable both hosts.
Windows gameplay, sign-in recovery, and physical notification-history clicks
remain release gates.

## Install and remove

Install Bun 1.4.3 or newer. Download `steam-native-notifications.tgz` and
`steam-native-notifications.tgz.sha256` from the
[rolling pre-release](https://github.com/tyvsmith/steam-native-notifications/releases/tag/latest),
then run in that download directory:

```powershell
$expected = ((Get-Content .\steam-native-notifications.tgz.sha256) -split ' ')[0]
if ((Get-FileHash .\steam-native-notifications.tgz -Algorithm SHA256).Hash -ne $expected) {
    throw 'Checksum mismatch: download both files again'
}
bun add --global --force --trust .\steam-native-notifications.tgz
if ($LASTEXITCODE -ne 0) { throw 'Package installation failed' }
$snn = Join-Path ((bun pm bin --global).Trim()) 'snn.exe'
& $snn setup
```

Run setup as your normal Windows user in the logged-in desktop. Windows global
Bun shims are not yet verified by the install-hook ownership check, so setup is
explicit. The commands below use Bun’s global binary directory directly because
winget installations may leave it off PATH. Use `& $snn setup --steam-dir 'D:\Steam'` for a nonstandard Steam root.
Restart Steam after its debugging marker is created. Configure delivery in
Steam Settings → Notifications → Steam Native Notifications.

```powershell
& $snn --host standalone doctor --json
& $snn --host standalone sample
& $snn teardown
bun remove --global @tyvsmith/steam-native-notifications
```

Teardown removes the per-user startup task and stops the daemon. The panel's
remove button defers stopping until Steam acknowledges the removal. Settings,
the Steam debugging marker, and shared notification branding remain. Branding
also belongs to the Millennium version and must not be deleted by this host.
Restart Steam to unload the injected frontend completely.

## Platform integration

- run a limited, interactive scheduled task at sign-in; no password or service
  account, no elevation
- keep configuration/state under `%LOCALAPPDATA%\steam-native-notifications`
- authenticate named-pipe requests and replies with a per-user HMAC secret;
  restrict its directory to the current user and SYSTEM
- hold kernel file handles for daemon/config exclusion; release on exit or crash
- require loopback CDP listeners owned by the same user's `steamwebhelper.exe`
  below the selected Steam root
- reuse the shared Steam panel, settings, capture, routing, and WinRT helper
- corroborate Windows game-host focus through the same one-shot helper as
  Millennium; retain Steam's selection when ownership cannot be established

Setup journals the previous task and restores it after an activation failure.
Run `snn recover` after interrupted setup. Recovery refuses a task that no
longer matches the saved before/after definitions; inspect that conflict before
changing it.

## Validation gates

- native Windows CI: build, authentication, kernel locks, named-pipe round trip,
  listener policy, settings contracts, PowerShell helper assertions
- guest: global package, setup/readiness, Steam attachment, settings changes,
  sample delivery and canonical click dispatch
- lifecycle: task upgrade/stopped state, rollback, remove-button reply,
  teardown and setup again
- hardware: foreground gameplay, Do Not Disturb/history, physical clicks,
  sign-out/sign-in and restart

See [platform evidence](platforms.md) for the existing Millennium WinRT tests;
those results do not establish standalone lifecycle support.

## Preview evidence (2026-10-17)

Windows 11 VM, Bun 1.4.3, package build `74141d822ca0`:

- global Bun install produced `snn.exe`; explicit setup registered the limited
  interactive task and matched the daemon PID to its task launch record
- repeated setup replaced the daemon; teardown stopped the owned process;
  setup after teardown started a new daemon
- configuration writes/readback covered the master toggle and Windows
  Notification Center-only setting, then restored defaults
- installed package, daemon and injected frontend reported the same build;
  notification hook, control and panel reported ready
- a captured screenshot showed the OS banner with avatar; Windows history
  stored its canonical Steam URI; programmatic activation replayed the captured
  handler without throwing
- native tests exercised competing-process/crash lock release, rejected pipe
  credentials, authenticated replies and listener ownership policy

The previous Millennium notification plugin was backed up and disabled in the
VM. Its loader remained installed. A clean client without that loader, physical
click/focus behavior, gameplay and sign-in recovery remain validation gates.

Setup interruption between registering a task and recording its returned XML
can require manual inspection: recovery refuses an unrecognized task rather
than overwrite it.

## Fix validation (2026-10-25)

Windows 11 VM, Bun 1.4.3, package build `eb1efdf25372`:

- reproduced the previous ACL failure with `SeSecurityPrivilege` removed from the process token; repeated directory protection and its user/SYSTEM-only ACL assertions passed with the replacement
- repeated the isolated ACL regression in three processes, then exercised the 21-test Windows suite
- installed the tarball, repeated setup, ran teardown/setup and confirmed matching installed, daemon and frontend identities with hook/panel/control ready
- verified the sign-in task used headless conhost and its daemon processes had no visible window; rebooted the guest and confirmed automatic startup and ready Steam reattachment
- checked the shared panel's sample prerequisite and execution feedback in Steam; observed FriendOnline capture and native delivery dispatch
- removed the temporary validation account and tasks; preserved notification preferences

The VM has UAC disabled. Restricted-token checks establish the missing-privilege
regression; they do not replace a full interactive installation under a standard
account with UAC enabled. One combined test run crashed inside Bun 1.4.3;
isolated ACL repeats and the subsequent combined run passed. The crash cause
remains unresolved. Human clicks and gameplay were not exercised in this pass.

### Sample preflight

Build `d33f749914d6` checks Steam’s live friend-online toast preference on each
sample request. Windows panel validation toggled it off, on and off again:
disabled requests showed an actionable error without calling the test method;
the enabled request called it once. The original preference was restored.
The permanent explanatory paragraph is removed from both host panels.

### Branded General sample

Build `e770f5d490f9` supersedes the friend-online sample and its prerequisite:

- use Steam's General notification with the title `Steam Native Notifications`
  and body `This is a test notification. Click to open Steam.`
- check General, global and in-game suppression before firing; show a short
  error when Steam blocks the sample
- verify panel delivery with friend-online notifications disabled and rejection
  with global suppression enabled; restore both preferences
- click the actual Windows Notification Center card with synthetic pointer
  input; observe exact handler replay and the minimized main window restored
- retain a new card across a full Steam process restart, attach the integration
  after Steam loads, then click it; observe missing-stash fallback to
  `steam://open/main` and a healthy main window

Automatic startup remains a separate gap: one full startup with the integration
active rendered `Cannot read properties of undefined (reading 'GetPlayer')`.
Steam loaded normally without the integration and remained healthy after late
attachment. The cause is unresolved; the retained-click check used late
attachment to isolate routing from that startup failure.

The VM's Millennium loader removed the remote-debugging marker and selected a
pipe instead of standalone's CDP port. Validation temporarily disabled that
loader. Physical clicks, gameplay, UAC-enabled installation and clean automatic
startup remain open.
