# Shared notification product: approval proposal

## Outcome and scope

Build items 1–4: a shared host contract, dev-tool parity, standalone configuration,
and a self-contained installable native Linux RT3 release. Preserve Millennium's
existing supported platforms and behavior. This milestone is a beta foundation;
it does not establish coverage of every real notification or complete the broader
recovery/compatibility work from items 5–6.

This document combines the design and execution proposal requested by Ty. Approval
authorizes implementation with subagents, local validation, publishing the result
to experimental/rt3-standalone-cdp, and leaving the standalone installation active.
It does not authorize merging, tagging, publishing a public release, replacing the
active Millennium plugin, editing Steam launchers, or restarting Steam unattended.

## Constraints

- Base implementation on the current experimental branch; preserve unrelated work.
- Keep the user's running Steam and notification service during development.
- Use isolated development checkouts; fixture tests must not touch live settings.
- No launcher changes or hardcoded graphical-session variables. Setup never launches
  or restarts Steam. Use the existing CEF marker and normal desktop launch.
- Leave the completed standalone version installed for exploration, retaining user
  preferences. If a new injected frontend needs a Steam restart, prepare everything
  first and coordinate one restart at the user's convenience.
- Standalone release target: native Linux x86_64 Steam RT3. Flatpak and other
  standalone platforms are excluded. Existing Millennium platform support remains.
- Developer commands are opt-in. Never synthesize TestIncomingVoiceChat.
- Keep existing replay/fallback and delivery-failure preservation rules.

## Design choice

Recommended: shared domain code and explicit host adapters, one control CLI, and a
small local browser settings UI. This avoids duplicating behavior or adding an
Electron/native desktop runtime. Millennium keeps its integrated settings panel.
The panels share setting definitions, labels, defaults, validation, availability,
and command semantics; their platform-specific rendering stays separate.

CLI-only settings would be simpler but insufficient as the proposed user-facing
configuration experience. Injecting an independent settings page into Steam would
introduce additional private UI dependencies; that is excluded from this milestone.

## Deliverable A: shared contracts

Extract typed host-neutral settings/schema and runtime interfaces. Contract includes
settings reads/writes/subscriptions, backend calls, capability reporting, diagnostics,
and developer requests/results. Share notification capture, localization, artwork
references, presentation policy, routing, replay and canonical click behavior.
Transport details remain in Millennium and standalone adapters.

Use shared metadata for all eight existing boolean settings. Preserve current
defaults and explicit user values. Advertise unsupported controls rather than
silently suggesting they work. Add a runtime build identity and protocol version
so tools can distinguish an installed build from the frontend Steam is running.
Retain compatibility for legacy positional RPC and raw/quoted return values.

Acceptance: both adapters pass the same settings/runtime contract scenarios;
existing routing, click and presentation tests pass; existing Millennium package
build/verification and standalone build both pass without installing Millennium.

## Deliverable B: shared control and developer tools

Introduce a packaged `snn` CLI with `--host auto|millennium|standalone`:

```
snn status
snn doctor
snn settings
snn dev fire TestDownloadComplete 1073390
snn dev capture
```

Add structured JSON output and conventional exit codes. Auto-selection uses live
host readiness; when both hosts are available, refuse ambiguous writes/test commands
and request an explicit selection. Read-only status may show both.

Keep tools/fire and tools/capture as compatible entrypoints using the same host
client. Preserve server rollup, overlay and replay diagnostic forms. Keep tools/mep
as the Millennium protocol utility; do not pretend standalone implements all MEP
methods. Product-level settings and dev operations go through the common CLI.

Standalone control uses a private user-runtime Unix socket with bounded framed
requests, allowlisted operations and permission checks. Millennium uses its existing
MEP/backend facilities. Track request IDs, deadlines, and request-scoped results
through frontend execution. Prevent stale command-file requests surviving a restart.
Report queued/executed/captured/delivery-attempted distinctly when measurable;
never equate helper acceptance with a visible banner. Unknown capability returns an
explicit unsupported result.

Acceptance: shared tests cover both hosts, ambiguity, offline hosts, dev access
disabled, malformed requests, concurrent callers, stale requests and timeouts.
Standalone fire/capture work without a .star or Millennium. Existing CLI forms work.

## Deliverable C: standalone configuration UI

`snn settings` opens a bundled settings page in the user's browser. Desktop entry
opens the same page. UI has inside/outside-game controls, connection/build status,
reset-to-defaults confirmation, and a safe test notification action. Developer-only
controls appear only after explicit devMode opt-in; development requests still
require devFire. A basic delivery test is fixed and safe, not arbitrary evaluation.

Serve static assets and narrow API from an on-demand loopback server, authenticating
with a per-session capability token, strict Host/Origin handling, bounded requests,
no permissive CORS and no arbitrary CDP evaluation. Launch URL carries the token in
the fragment; requests use authorization headers. Redact tokens from logs. Bind
only loopback; UI access never opens Steam's debugging port to remote hosts.
UI server lifetime follows the settings command rather than adding an always-on
public web endpoint. Report browser-launch failures and offer the local URL.

Standalone settings remain XDG JSON, writable even while Steam is closed. Shared
schema validates known values; atomic writes preserve unrelated keys and serialize
concurrent changes. Existing files require no reset. Running daemon adopts changes
without a Steam restart. Invalid external edits are reported and retain last valid
settings; cold startup uses documented defaults. Config reset changes known values
only, preserving unrelated data. Millennium writes its own config store using the
same schema; its panel consumes shared metadata.

Acceptance: offline editing, persistence, live propagation, defaults, invalid edits,
concurrent CLI/UI writes, unsupported controls and UI authorization rejection tested.
Browser checks verify saving and reloading, status and the safe test action.

## Deliverable D: installable release artifacts

Build a versioned native Linux x86_64 tarball containing a compiled Bun executable,
frontend and settings assets, shared notification/focus helpers, license and manifest.
Installed execution requires neither a source checkout nor a separate Bun install.
System dependencies remain explicit: native Steam, compatible glibc, libnotify/GLib,
curl, and optional LuaJIT/libwayland for the existing focus provider. Select and
document a glibc floor from the pinned CI builder and test the shipped binary there.
Report missing required dependencies; missing optional focus support is a degraded
capability, not a silent success. Do not install OS packages automatically.

Use the existing ownership-aware setup behavior for marker, service and autostart.
Install versioned assets beneath XDG data home with a stable executable entrypoint.
Support explicit upgrade and rollback; atomically switch versions and retain the
previous version until health checks succeed. Report frontend-version mismatches
and any required voluntary Steam restart. Test migrating the current source-backed
installation without losing settings or claiming ownership of shared files.

Release tarball provides install/status/doctor/upgrade/rollback/uninstall commands.
Uninstall preserves user-modified settings and shared/preexisting marker. CI builds
both `.star` and standalone artifacts, records version/build identity, generates
checksums and validates assets. Preserve release dry-run behavior and extend the
release workflow; do not create a tag/public release as part of this work.

Acceptance: install in a clean temporary home from an extracted tarball; remove
the checkout and Bun from PATH and still run CLI/settings/daemon. Test upgrade,
rollback, interrupted install, missing dependencies, paths containing spaces,
preexisting/modified files and migration from the current installation. Check a
real user service locally, preserving the desktop session environment.

## Execution and subagents

1. Coordinator establishes isolated checkouts, records current live version/settings,
   and freezes interfaces, CLI grammar and package layout. Reconcile existing docs
   with source when they disagree. No changes to the live setup during this stage.
2. Contract implementation agent delivers A with regression tests. A fresh reviewer
   checks behavior and adapter parity before dependent tasks start.
3. Developer/control agent delivers B. Settings agent delivers C against the frozen
   contract, and packaging agent delivers D. Dispatch independently where ownership
   permits; share exact contracts and require changes through the coordinator.
4. Fresh reviewers check each deliverable for spec compliance and failure behavior.
   Coordinator integrates commits and resolves any cross-task failures.
5. Independent whole-branch review checks drift between hosts, configuration/control
   security, installer ownership and packaged-runtime completeness. Fix findings
   before local installation.
6. Run complete relevant suites, typecheck, both builds, .star verification, tarball
   smoke tests and browser tests. Publish the experimental branch with clear evidence.
7. Install locally while preserving settings. Prepare any needed frontend update
   before a single coordinated Steam restart. Validate a safe native test, no duplicate
   desktop Steam toast under current settings, click behavior, live settings changes,
   packaged CLI and reconnection. Leave new service and marker installed/running.

Agents work in assigned files/checkouts, do not mutate Steam or live configuration,
and report exact commits and tests. Coordinator owns integration, live validation,
publishing the experimental branch and final evidence. Previously requested cloud
implementation preference is retained where cloud execution is available; desktop
checks stay local. Preserve all prior chats.

## Completion evidence and limits

Deliver source commits, shared contract tests, functioning old/new dev entrypoints,
settings UI/CLI, standalone tarball/checksums, CI/release workflow updates, installation
and migration documentation, and a concise validation matrix separating fixture,
browser and live evidence. Record anything that requires unavailable Millennium or
another OS session as unvalidated rather than activating another host on live Steam.

Full notification coverage, broad real-event testing, full Gamescope/compositor
recovery, Steam-update monitoring, Flatpak and extra standalone architectures are
future work. Minimal lifecycle/security/version checks needed for A–D are included;
this proposal does not label the beta universally production-ready.

## Approved refinements
Configuration file plus settings UI; omit public config get/set/reset CLI. Small installation/status/doctor/settings CLI and existing developer tools remain. Build usable independent settings UI now; Steam settings-window integration is explicitly deferred. Existing installed setup survives development.
