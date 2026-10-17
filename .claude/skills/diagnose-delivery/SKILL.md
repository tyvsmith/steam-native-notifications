---
name: diagnose-delivery
description: Use for missing desktop notifications, wrong artwork, mangled bodies, or clicks that fail or navigate incorrectly
---

Walk capture, dispatch, helper, daemon and activation in order. Select the host
explicitly with `tools/capture --host millennium` or `--host standalone`.
Confirm installed, daemon/backend and frontend freshness before diagnosing.
Standalone status also reports hook, panel and command readiness.

## Capture and delivery

- no toast capture: check hook health and whether Steam painted the toast
- `dev-fire:` without capture: inspect Steam notification preferences, test
  gates and sender availability; execution does not imply capture
- capture followed by rejected dispatch: preserve Steam's toast and inspect
  the host error
- helper launch or successful command receipt: continue to the daemon;
  neither proves a visible banner
- never stringify arbitrary notification objects without `safeJson`

Millennium logs to `~/.cache/steam-native-notifications/plugin.log`;
standalone uses `$XDG_STATE_HOME/steam-native-notifications/standalone.log`
(default `~/.local/state`). Logs contain private notification content.

## Helper seams

```sh
tools/notify-action --resolve-icon 'https://steamloopback.host/assets/1073390/library_600x900.jpg'
tools/notify-action --escape-markup 'a < b & c'
tools/notify-action --daemon-caps
```

`--notification-url PAYLOAD` wraps an already encoded envelope; it does not
validate the envelope or prove delivery. Library artwork comes from Steam's
cache; remote avatars use bounded curl with Steam loader variables cleared.
The `image-path` hint lets the daemon retain file-backed artwork. Check daemon
capabilities before attributing literal markup to extraction.

## Activation

Linux default actions launch the canonical Steam URL. Quickshell also receives
a fixed `steam`, URL argv hint which Quattro can retain in history. Arbitrary
FreeDesktop daemons do not promise executable history actions.

| Evidence | Next check |
|---|---|
| no `steam-url: click` | OS action did not reach the registered Steam frontend; inspect action lifetime, daemon history support and frontend readiness |
| `steam-url: click` without successful `click-bridge:` outcome | inspect envelope rejection, surface discovery and dispatch errors |
| no stash entry | Steam restarted or the entry fell out of the 256-entry stash; inspect durable fallback |
| replay threw | inspect captured Steam store changes and fallback outcome |
| dispatch returned but destination unseen | observe the actual Steam window and focus; navigation may occur inside an existing window |

Replay has no time expiry. Its capture surface is authoritative; unknown or
contradictory current focus refuses dispatch. Without safe replay or a verified
fallback the click remains inert. The click-file poll is a legacy/test seam,
not the Linux notification action transport.

A direct protocol invocation proves a different layer from a physical click.
Record visible banner, physical click, destination and focus separately. A
Steam-owned toast needs a Steam window focused to accept clicks; that rule does
not establish the native desktop daemon's behavior. See live-verify.
