# Windows standalone preview

Draft support for native Windows x64 Steam without Millennium. The same Bun
package contains both Linux and Windows support. Do not enable both hosts.
Windows gameplay, sign-in recovery, and physical notification-history clicks
remain release gates.

## Install and remove

Install Bun 1.4.3 or newer, then install the preview tarball globally:

```powershell
bun add --global --trust .\snn-preview.tgz
snn setup
```

Run setup as your normal Windows user in the logged-in desktop. Windows global
Bun shims are not yet verified by the install-hook ownership check, so setup is
explicit. Use `snn setup --steam-dir 'D:\Steam'` for a nonstandard Steam root.
Restart Steam after its debugging marker is created. Configure delivery in
Steam Settings → Notifications → Steam Native Notifications.

```powershell
snn --host standalone doctor --json
snn --host standalone sample
snn teardown
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
- leave Windows game-host focus unknown until its separate validation lands

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
