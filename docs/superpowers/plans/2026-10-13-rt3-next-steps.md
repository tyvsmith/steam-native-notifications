# Converge standalone RT3 behavior and deliver Steam settings

**Status:** implementation milestones 1–6 delivered for local testing October 15, 2026; release gates remain open

**Goal:** deliver usable settings inside Steam first, then converge and harden the product

**Architecture:** retain shared notification behavior and native host adapters. Add a narrow, optional settings bridge over the existing standalone binding. Keep the external editor as fallback.

## Execute in this order

| Milestone | User outcome | Acceptance |
|---|---|---|
| 1: Steam panel | configure standalone in Steam Settings → Native Notifications | build, install, verify navigation, persisted toggles, sample, reset, external edits and recovery; stop for user exploration |
| 2: consistency | matching settings and behavior across supported interfaces | shared policy and both-host contract checks; retain host-specific storage |
| 3: developer tools | predictable capture, fire, doctor and status commands | consistent grammar, accurate readiness, compatibility entrypoints |
| 4: packaging/install | safe installation, upgrade, rollback and uninstall | exact candidate health, preserved service state, negative lifecycle fixtures |
| 5: polish/cleanup | clear errors, accessible controls, maintainable code | regression review, failure recovery, remove obsolete paths |
| 6: docs | accurate setup, support and release guidance | documented tested scope and reproducible release procedure |

The detailed tasks below retain their original IDs as review references; this table supersedes their ordering and dependency statements. Move only prerequisites necessary for panel correctness into milestone 1. Public release remains gated on packaging and documentation. No broader platform expansion.

**Execution ruling:** use the existing experimental checkout because the app-created worktree is read-only in this sandbox. Preserve unrelated untracked files. Installation and autonomous Steam restart are authorized.

## Current milestone status

- accepted panel milestone; implemented shared settings policy and editor error handling
- converged CLI option order, host selection and operation evidence
- hardened installation readiness, service-state preservation and recovery; normalized paths and bounded logs
- included package instructions and runtime-distribution audit
- installed candidate `a2efd134a955`; matching frontend/backend identities, live settings and visible sample validated
- restarted only the daemon after Steam was running; it reattached with the same frontend identity, installed hook and panel
- retained release gates: physical banner/history clicks, broader game/login coverage, complete runtime redistribution materials
- see [validation and remaining gates](../../experiments/rt3-validation.md)

## Milestone 1 execution status

- built and installed candidate `f80100f09fe7` on October 15
- added Steam settings page, validated write bridge, fixed sample, reset confirmation and connection feedback
- reused external editor write policy; deferred broader convergence
- verified live private-interface discovery against Steam build `1791592380`; handle its MobX registry and wait for open dialogs to close
- passed 92 standalone tests, 3 host contracts, existing-plugin tests, noninstalling pack and compiled-package smoke
- preserved configuration bytes and previous packages
- restarted Steam; installed, daemon and frontend identities match; hook and panel installed
- verified actual panel navigation, close/reopen, all four persisted toggles, confirmed reset/cancel and external updates
- verified disconnect disables controls and service restart reconnects without duplicating the panel
- observed a visible desktop sample banner; restored original preference values
- panel milestone complete for user exploration; physical notification-click/history validation remains separate

### Approved visual revision

- installed `b02d5458cd17`; daemon/frontend/package identities match
- reuse Steam desktop theme, switches, rows, section headings and buttons
- place entry after Music with notification icon and visible native divider
- hide healthy connection status; retain actionable errors
- verified screenshot, all four saves, reset/cancel, external edits, navigation and sample request against the updated Steam client
- passed 92 standalone tests, 3 host contracts and compiled-package smoke; preferences restored and panel left open

## Preserve existing functionality

- reuse `frontend/runtime.ts`, extraction/text, presentation, replay, fallback routes and canonical URL handling
- reuse `tools/notify-action`, Linux focus policy and `frontend/devfire.ts`
- retain `shared/settings.ts` as the source of keys/defaults/labels/validation
- retain `tools/fire` and `tools/capture` grammar as compatibility entrypoints to the same host client
- keep `tools/mep` Millennium-specific
- retain external settings as the offline editor and fallback when Steam integration is unavailable
- retain separate host preference stores; sharing schema does not imply automatic preference migration
- keep standalone native Linux x64 RT3 only; preserve existing Millennium platform behavior

Exclude new notification routes, per-type filters, sounds, scheduling, telemetry, automatic update downloads, a new config CLI, Big Picture, Steam Deck layout support, Flatpak, standalone Windows/macOS and extra architectures. Do not introduce AppImage, deb/rpm packaging or another updater in this scope.

## Apply the operating constraints

- read `AGENTS.md`, `docs/architecture.md`, `docs/steam-routing.md`, `docs/platforms.md` and `docs/standalone-release.md`
- use the original `notification-product-proposal.md` for history; this revised scope supersedes the preceding next-steps draft
- preserve unrelated work and develop against the experimental branch in an isolated checkout
- keep tests on temporary config/runtime paths with stub delivery; never activate both notification hosts on live Steam
- never synthesize `TestIncomingVoiceChat`
- avoid `bun run build`, which installs Millennium; use the non-installing gate below
- prepare candidate package, backup and rollback details before live installation approval
- coordinate Steam restart, real download/install, login/logout, Gamescope and service interruption before disruptive tests
- ask before sudo with exact commands; do not edit Steam launchers or runtime-selection markers
- keep raw private logs, account IDs and screenshots out of public evidence
- prepare a draft PR through `pr-writer`; no merge, tag or public publication under this plan alone

## M0: Preserve current evidence

**Files:** create `docs/experiments/rt3-validation.md`; read `standalone/control-host.ts`, `standalone/diagnostics.ts`, saved product validation record and current service/install journal

- [ ] record commit, Steam version, package checksum and installed/daemon/frontend identities before edits
- [ ] run installed `snn status --json`, `snn doctor --json`, and `snn --host standalone capture 20 --json` from the actual graphical-session environment
- [ ] record service enabled/active state separately; user-bus access failure means unverified, not stopped
- [ ] preserve settings bytes/hash privately and distinguish current values from defaults
- [ ] record final-build capture separately from older visible-banner/physical-click evidence
- [ ] create a matrix with artifact, scenario, fixture/live observation, result and unresolved limit

**Gate:** reproducible baseline without changing the running installation. Never infer physical delivery from historical logs or request acknowledgement.

## M1: Converge existing user interfaces

### M1a: Make command dispatch and diagnostics consistent

**Files:** `standalone/product.ts`, `standalone/cli.ts`, `standalone/client.ts`, `standalone/control-host.ts`, `shared/host.ts`, `tools/lib/cli/fire.ts`, `tools/lib/cli/capture.ts`

**Tests:** add `standalone/cli.test.ts`; extend `standalone/client.contract-test.ts`, `standalone/control-host.test.ts` and compiled checks in `tools/test-packaged.ts`

- [x] pin the doctor defect with `doctor --host standalone --json` and `--host standalone doctor --json`; require equivalent diagnostics
- [x] parse common options once and dispatch each command once; preserve legacy fire/capture arguments
- [x] provide concise human output by default and structured output for `--json`; report failures consistently and document exit status
- [x] make status without a host list both; explicit host filters status/doctor; automatic mutation refuses two eligible hosts
- [x] make settings destination explicit: plain `snn settings` remains standalone and says so; explicit Millennium gives guidance for its existing panel; explicit auto selects the sole host or reports ambiguity, never silently edits another store
- [x] keep doctor read-only with concrete dependency/config/endpoint errors; Steam closed is a normal waiting state
- [x] type status fields for backend availability, frontend identity, hook/control state, dependencies and evidence; unknown stays unknown
- [x] scope capabilities by operation/transport and select commands by eligibility; Millennium backend running cannot establish frontend readiness
- [x] retain Millennium queued results until execution is observed; preserve standalone correlated execution results
- [x] move parsing/host selection to neutral ownership only where needed to remove unwanted dependencies; directory relocation alone is not a release gate

**Gate:** option order cannot change meaning; status and command eligibility describe actual evidence. Fixture parity is not live Millennium parity.

### M1b: Share settings policy and repair the external editor

**Files:** `shared/settings.ts`, new `shared/settings-policy.ts`, `frontend/SettingsPanel.tsx`, `standalone/settings-assets.ts`, `standalone/settings-server.ts`, `standalone/config-store.ts`

**Tests:** new `shared/settings-policy.test.ts`; extend `standalone/settings-parity.test.ts`, `standalone/settings-server.test.ts`, `standalone/config-store.test.ts`

- [x] share visibility/explanation policy: hide unsupported controls, explain overlay capture after alt-tab, show the existing both-off consequence
- [x] define reset preferences as supported presentation keys plus `devFire=false`, preserving `devMode`, unsupported-platform and unrelated keys; keep internal reset-all separately named/tested if needed
- [x] share small policy functions and copy across renderers; retain host storage and widgets
- [x] update developer guidance for packaged `snn dev fire` and compatible repository tools
- [x] on settings-server expiry/loss, clear stale ready text, disable unavailable actions and offer reopening; do not suggest a Steam restart for editor expiry
- [x] preserve editing while Steam/daemon is stopped if the settings server is running
- [x] preserve malformed JSON bytes, refuse writes and label displayed values as last-known/default; defaults in a new editor are not the daemon's effective settings
- [x] test offline save/reopen, rejected saves, concurrent edits, reset scope, expired session and unknown platform
- [x] test the fixed sample with `devMode=false` and `devFire=false`; arbitrary developer commands remain gated

**Gate:** editors agree on shared settings meaning and report errors accurately. No universal controller or additional Millennium panel features are required.

## M2: Harden installation and ecosystem integration

### M2a: Verify candidate activation before committing

**Files:** `standalone/installer.ts`, `standalone/setup.ts`, `standalone/package-manifest.ts`, `standalone/control.ts`, `standalone/control-host.ts`

**Tests:** `standalone/installer.test.ts`, `standalone/setup.test.ts`, `tools/test-packaged.ts`; add manifest-mode coverage

- [x] reject missing executable permission or incompatible package identity before managed mutations
- [x] generate Type=exec units; use a bounded private-control readiness check tied to current service MainPID and expected candidate build
- [x] accept a responsive daemon waiting for Steam or an older injected frontend; never force Steam to launch/restart during installation
- [x] reject old daemon/socket responses, wrong identity, immediate exit after exec and startup timeout
- [x] retain the transaction until intended activation is verified; preserve recovery evidence if recovery fails
- [x] snapshot enabled/active manager state; fresh installs enable/start, upgrades/rollbacks preserve intentionally stopped or disabled state
- [x] if activation is intentionally deferred, validate assets and report staged with startup unverified; do not start a disabled service merely to satisfy readiness
- [x] test all enabled/active combinations, startup failures, stale socket, Steam closed, older frontend and failed recovery

**Gate:** success describes measured state; recovery restores files and prior service-manager state.

### M2b: Allow removal without a working Steam installation

**Files/tests:** `standalone/installer.ts`, `standalone/installer.test.ts`, `tools/test-packaged.ts`

- [x] separate owned-target validation from Steam runtime discovery for uninstall/recovery
- [x] retain exact file/link/release ownership checks; use recorded Steam path only to preserve/report the marker
- [x] test uninstall after Steam is removed, moved or its disk unavailable
- [x] repeat interrupted removal and modified-owned-file cases; preserve preferences/shared marker
- [x] explain that injected hooks disappear when Steam exits

**Gate:** removing Steam first does not strand standalone assets or expand deletion authority.

### M2c: Normalize paths, session files and logs

**Files:** `standalone/paths.ts`, `standalone/config-store.ts`, `standalone/daemon.ts`, `standalone/host.ts`, `standalone/setup.ts`, `standalone/installer.ts`, `standalone/control-host.ts`, `tools/lib/snn.ts`

- [x] use one XDG resolver across install/runtime/editor; test unset, empty, relative and absolute values
- [x] keep sockets in owned XDG_RUNTIME_DIR; diagnose missing session environment without inventing a socket path
- [x] keep one systemd-owned daemon; autostart imports current session environment and activates that service
- [x] validate generated entries with desktop-file-validate and systemd-analyze --user verify; test spaces and reserved Exec characters
- [x] bound standalone logs to an active 5 MiB file plus one rotated file; retain private permissions
- [x] put new standalone diagnostic logs under XDG state; keep legacy cache-log reading during transition and shared helper/Millennium paths compatible
- [x] document single graphical session per user, required dependencies and optional focus degradation

**Gate:** consistent path selection and bounded logs; real session activation remains a live M3 check.

## M3: Validate the exact standalone package

**Files:** `docs/experiments/rt3-validation.md`; fix demonstrated defects in their owning runtime/helper module with regressions

- [ ] run the non-installing gate; build package/checksum with Bun 1.4.3
- [ ] prepare install/rollback details and coordinate live upgrade, preserving preferences and marker ownership
- [ ] verify candidate identities, current hook/control state and dependency diagnostics
- [ ] test shipped safe-sample button without developer opt-in; separate execution from capture and visibility
- [ ] separately use gated `snn --host standalone --json dev fire TestDownloadComplete 1073390` for artwork/click coverage; restore developer settings
- [ ] observe visible banner and physical click from a neutral desktop window; verify page and focus
- [ ] after agreed Steam restart, physically click retained history and verify durable routing with old replay unavailable
- [ ] observe real download completion and real friend/chat events when available; keep synthetic evidence separate
- [ ] verify desktop replacement and in-game settings live; cover all presentation combinations in fixtures
- [ ] test daemon reconnect/UI reload without duplicate capture; verify known pre-launch failure preserves Steam's popup
- [ ] test native-server failure in isolation and document the post-helper-launch acknowledgement limit
- [ ] coordinate login/autostart, Gamescope and compositor reconnect when available; list exact unverified scenarios otherwise
- [ ] restore temporary preferences, DND changes and services

**Required gate:** exact-artifact visible banner, physical banner/history clicks, settings save/reload and healthy recovery. Unavailable real social events, Gamescope and broader sessions stay explicit compatibility limits and do not block unrelated work indefinitely. Steam suppression or DND does not establish failed transport.

## M4: Integrate optional desktop Steam settings

### M4a: Prove the private UI seam

**Read:** shipped Steam settings code, `standalone/browser.ts`, `standalone/adapter.ts`, `frontend/SettingsPanel.tsx`, shared settings policy

**Create:** `docs/experiments/rt3-settings-integration.md`

- [ ] record Steam build/source evidence for navigation, rendering, context ownership and cleanup
- [ ] identify narrow registration seam; coordinate disposable live page with no preference writes
- [ ] prove reopen/reload/removal causes no duplicate entries or damage to existing settings
- [ ] specify exact scoped bridge methods for read, validated patch, preference reset, subscriptions/cleanup and fixed sample over existing private transport
- [ ] exclude arbitrary evaluation, paths, installer commands and additional exposed servers
- [ ] record concrete interfaces and fixtures from the probe before implementation

**Gate:** verified desktop registration and transport. If broad patching or unsafe coupling is required, return findings/alternatives for review. A link to the external page does not satisfy embedded-panel acceptance.

### M4b: Implement with M1 policy

**Proposed files:** `standalone/steam-settings.ts`, `standalone/steam-settings-panel.tsx`, `standalone/steam-settings.test.ts`; update browser/adapter/build and narrow host bridge only as required

- [ ] implement desktop/in-game native and Steam visibility controls using shared policy
- [ ] show connection/restart/error state, compact version, fixed sample and confirmed preference reset
- [ ] show existing developer controls only after opt-in; hide Windows-only fields on Linux
- [ ] acknowledge saves/errors; propagate changes to runtime and external editor without restart
- [ ] fixture-test missing/ambiguous seam, duplicate attachment, reopen, reload and disposal
- [ ] test invalid patch, concurrent edits, stale frontend, unavailable backend, reset scope and sample eligibility
- [ ] verify keyboard, focus, labels and resizing in Steam; then repeat notification/click checks
- [ ] force adapter refusal in fixtures and verify capture, canonical URLs and external settings continue

**Gate:** embedded settings adds placement; policy/storage remain shared and panel failure cannot disable notifications.

## M5: Prepare distribution and review

**Files:** `tools/build-release.ts`, `standalone/package-manifest.ts`, `.github/workflows/build.yml`, `docs/standalone-release.md`, `docs/experiments/rt3-standalone.md`, `docs/platforms.md`, validation record and package docs/notices

- [ ] keep versioned compiled tarball; verify arbitrary cwd and no checkout/Bun runtime dependency
- [x] include concise installation/lifecycle instructions and dependency list beside the runtime in the archive; preserve format-1 runtime allowlist for old-manager compatibility
- [ ] audit pinned Bun/runtime notices and distribution materials before any public binary upload; record unresolved obligations
- [ ] retain source/build/checksum provenance; distinguish integrity from publisher authentication
- [ ] document tested CPU/libc/distro floor; retain Ubuntu 22.04 CI and support only evidenced compatibility claims
- [ ] replace stale source-install/tool instructions; label source setup as development/migration support
- [ ] run final regression/compiled checks and repeat M3 core checks after M4 on the exact candidate
- [ ] review own diff with /code-review, resolve actionable findings and create draft PR with pr-writer
- [ ] return artifact, evidence, limitations and review link; leave merge/tag/publication for separate direction

**Gate:** reproducible candidate with explicit evidence and distribution materials; no universal Linux or notification-coverage claim.

## Run the non-installing regression gate

```sh
bun install --frozen-lockfile
bun run typecheck
bun test tools/gen-build-identity.test.ts
bun run test
bun run build:standalone
bun run test:standalone
bun tools/build-release.ts
bun tools/test-packaged.ts
mkdir -p dist
./node_modules/.bin/starlight pack -o dist
./node_modules/.bin/starlight verify dist/me.tysmith.steam-native-notifications.star
```

Add new policy/CLI tests to suites and CI. Keep client mock tests in their existing separate process. Build standalone before tests; inspect generated identity and exclude incidental artifacts from commits. Reproduce each defect with a failing test before fixing it, then run affected checks.

## Review the failure cases

| Condition | Required behavior | Milestone |
|---|---|---|
| Different option placement | same command and result schema | M1 |
| Editor expiry or malformed config | truthful state; no false save or overwrite | M1 |
| Different host instrumentation | explicit evidence and operation eligibility | M1 |
| Candidate fails or old daemon replies | reject activation, preserve recovery/service state | M2 |
| Steam removed or installation disabled | uninstall works; upgrade respects user intent | M2 |
| Installed/injected builds differ | daemon may run; unsafe frontend commands refuse | M1–M3 |
| Steam settings internals change | panel refuses; capture/external editor remain | M4 |

The user accepted the Steam panel and authorized the remaining milestones. Implementation is available locally; release approval remains separate.
