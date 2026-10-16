# Review standalone RT3 convergence and release readiness

**Decision:** preserve the shared notification core and Linux package model. Fix existing tool/settings inconsistencies and installer acceptance before adding another settings surface.

**Scope:** branch `experimental/rt3-standalone-cdp`, commit `67ca235`; installed build `684e743fee6c`. Read-only review and isolated tests; no product or live-installation changes.

## Assess the user journey

“Built” means source and tests exist. “Live” describes the recorded desktop evidence, not every supported environment.

| User action | Standalone today | Evidence and limits |
|---|---|---|
| Install without Millennium, Bun or a checkout | compiled Linux x64 tarball, user installer and desktop launcher | installed locally; compiled smoke fixtures cover ordinary installation; startup acceptance gap below |
| Log in and launch Steam normally | user service plus XDG autostart; persistent CEF marker | earlier session records user-confirmed reboot success; latest packaged login path not independently repeated |
| Receive desktop notifications | shared capture, rendered text, artwork and Linux delivery | current build captures real events and requests delivery; earlier build had visible-banner evidence |
| Receive in-game notifications | separate native/Steam visibility settings | current build captured overlay and download samples; broad game/focus coverage incomplete |
| Click a banner | exact captured callback, with verified route fallback | physical click passed on earlier build; final artifact needs repeat |
| Click notification history after restart | canonical URL retains fallback | earlier stored-action validation; final physical history click still pending; history behavior depends on desktop daemon |
| Change settings | application-menu entry or `snn settings`; JSON persists while Steam is closed | actual store/UI fixtures; Steam panel absent; expired external page can show stale ready state |
| Send a sample | external button uses fixed friend-online sample without developer opt-in | execution acknowledgement only; Steam preferences/persona can prevent visible toast; download dev test is separate |
| Inspect health/capture | `snn status`, `doctor`, `capture`; legacy wrappers select hosts | live status ready with matching IDs; doctor option-order defect and unequal readiness evidence |
| Run developer commands | `snn dev fire` or `tools/fire`, explicit developer opt-in | shared validation/execution; standalone replies executed, Millennium queue replies queued |
| Upgrade or roll back | versioned assets, active symlink, transactional ownership records | fixture coverage; preserves preferences; does not yet prove daemon startup before committing |
| Uninstall | removes owned service/launchers/assets; keeps settings/shared marker | fixture coverage; currently fails when recorded Steam installation no longer exists |

## Separate reuse from host ownership

| Area | Shared implementation | Millennium responsibility | Standalone responsibility |
|---|---|---|---|
| Notification behavior | `frontend/runtime.ts`, extraction, rendered text, presentation, replay, routes, URL dispatch | load frontend through plugin host | attach through loopback CDP and alias host adapter |
| Linux delivery | `tools/notify-action` | Lua marshalling/spawn | Bun host marshalling/spawn |
| Gamescope focus | `backend/game_focus.lua`, `backend/focus/*` | embedded LuaJIT access | external LuaJIT runner |
| Settings definitions | `shared/settings.ts`: keys, defaults, labels, validation | per-key config store and React widgets | atomic JSON store and external DOM renderer |
| Settings behavior | partly shared | conditional Windows controls, capture-surface explanation | separate visibility/reset policy; missing explanations |
| Developer execution | command grammar, validation, `frontend/devfire.ts` | MEP discovery plus expiring file queue | private Unix control socket and correlated CEF call |
| Diagnostics | build identity and some contracts | backend status plus plugin capture report | installed/daemon/frontend identity and hook/control probes |
| Installation | shared repository/version/build workflow | `.star`, Millennium lifecycle | compiled tarball, systemd user service, desktop/autostart entries, installer/recovery |
| Settings placement | no shared renderer required | existing plugin panel inside Steam | external browser today; optional Steam panel proposed |
| Platforms | shared domain behavior | Linux native; experimental Windows; macOS delivery refusal | native Linux x64 RT3; Flatpak excluded |

The principal reuse is real: `standalone/browser.ts:1` starts `frontend/runtime.ts`; `standalone/build.ts:9` substitutes the host adapter. Standalone calls the existing Linux helper (`standalone/host.ts:70`) and focus policy (`standalone/focus.lua`). Preserve those boundaries.

## Address the findings

| ID | Priority | Finding and consequence | Required plan change |
|---|---|---|---|
| R1 | beta gate | `installer.ts:138` discards the transaction after restart returns; `Type=simple` does not prove executable startup; manifest ignores executable mode | validate executable, use appropriate systemd startup type, verify candidate daemon identity/control before committing |
| R2 | beta gate | `installer.ts:18,145` rediscover Steam before uninstall; removing Steam first strands owned installation | separate ownership validation from live Steam discovery |
| R3 | tooling gate | `product.ts:8–14` and `cli.ts:17` implement different doctor paths; global-option placement changes output or errors | parse once; define one command/output/error contract |
| R4 | UX gate | `settings-assets.ts:8` retains ready state and enabled sample after settings server expires | clear stale state, disable unavailable actions, give reopen guidance |
| R5 | convergence gate | shared schema does not own visibility, explanations or user-facing reset policy | share small policy functions and scenarios before another renderer |
| R6 | convergence gate | `client.ts:20` calls Millennium backend running “ready”; standalone requires more evidence; capabilities have unspecified transport scope | type evidence and operation eligibility; preserve queued/executed distinction |
| R7 | panel prerequisite | standalone browser settings adapter is read-only; existing Millennium panel writes through its own hook | add only the narrow validated browser settings bridge required for the new panel |
| R8 | distribution gate | manifest includes project LICENSE but no explicit bundled-runtime inventory | audit pinned Bun runtime notices and distribution material before public binaries |

R1's missing-executable-mode acceptance and R2's missing-Steam uninstall refusal were reproduced in isolated fixtures. A real systemd false-success install was not performed; R1's startup consequence follows from the source and documented systemd semantics. R3 was reproduced with the installed binary. R4 was reproduced using the actual page JavaScript with a simulated connection loss.

### Retain intentional differences

- retain Millennium FFI/config and standalone CDP/socket/file storage
- retain host-specific renderers; share meaning and tests rather than force one UI toolkit
- distinguish reset presentation preferences from low-level reset-all operations
- preserve capability scope: browser write unsupported and daemon write supported can both be correct
- keep `tools/mep` Millennium-only; keep `tools/fire` and `tools/capture` compatible wrappers
- move shared parsing/client code only as needed to give it neutral ownership; directory relocation alone is not a release gate
- keep the fixed user sample independent of `devFire`; arbitrary developer commands remain gated

### Correct the activation proposal

- accept a healthy candidate daemon waiting for Steam or an older injected frontend
- verify the new daemon's PID/build through private control; do not accept an old process/socket response
- snapshot service enabled/active state and restore it after failed upgrades
- preserve a deliberately stopped/disabled installation across upgrade/rollback; report staged rather than ready when activation is intentionally deferred
- retain managed-file/link ownership checks during missing-Steam uninstall

## Apply ecosystem conventions

| Area | Assessment | Next action |
|---|---|---|
| Per-user installation | XDG data/config/state roots and `~/.local/bin` are a suitable foundation | use one validated XDG resolver; runtime/config paths currently also use raw environment values |
| Session lifecycle | user service and graphical-session environment import are appropriate | retain one daemon; validate generated units/autostart entries and stopped/disabled upgrade behavior |
| Process startup | `Type=simple` is insufficient for the installer's success promise | use `Type=exec` plus application readiness; exec success alone cannot prove initialization |
| Package format | compiled tarball is reasonable for an experimental native Linux release | keep one artifact pipeline; avoid premature AppImage, deb/rpm or a second updater |
| Diagnostics | logs currently append without rotation under cache | add bounded retention, select/document a state-log location, keep old capture paths readable during migration |
| Command interface | shared grammar exists, dispatch/output is inconsistent | one parser, discoverable help, human output and explicit JSON, meaningful doctor result |
| Desktop integration | entries and quoting already exist | run `desktop-file-validate` and `systemd-analyze --user verify`; add install instructions to package |
| Dependencies/platform | Bun compiler pinned, runtime embedded, Linux x64/Ubuntu 22.04 test floor documented | validate executable mode, arch/libc compatibility and required tools; report optional focus as degraded |
| Distribution | checksums provide integrity, not publisher identity | retain exact source/build provenance and resolve runtime notices before public publication |

Primary references:

- [XDG Base Directory Specification](https://specifications.freedesktop.org/basedir/0.8/): absolute paths, config/data/state/cache separation and runtime directory ownership
- [systemd desktop integration](https://github.com/systemd/systemd/blob/main/docs/DESKTOP_ENVIRONMENTS.md): graphical-session integration and one graphical session per user
- [systemd service types](https://github.com/systemd/systemd/blob/main/man/systemd.service.xml): `simple` versus `exec` startup semantics
- [Desktop Entry Exec rules](https://specifications.freedesktop.org/desktop-entry/latest/exec-variables.html) and [XDG autostart](https://specifications.freedesktop.org/autostart/latest/): launcher quoting and session startup
- [Bun executables](https://bun.com/docs/bundler/executables): compiled executable deployment; verify behavior against pinned 1.4.3 rather than changing compiler during this work
- [Bun licensing](https://bun.sh/docs/project/license): linked runtime components require a distribution inventory; no legal-violation finding is asserted here

## Record verification and confidence

- verified live: installed, daemon and frontend identities match; standalone reports ready, hooks/control active; Millennium absent from this running session
- passed 23 targeted contract, settings, config-store, control-host, runtime-path and dependency tests
- passed 30 installer, setup and runtime-path tests in the independent packaging check
- inspected existing CI/package fixtures; did not rebuild, install or run physical desktop tests during this review
- classified final-package physical clicks, visible sample, fresh login, Gamescope and broad desktop compatibility as incomplete evidence

**Confidence:** high in shared-core reuse and reproduced consistency/lifecycle gaps; limited in untested desktop/platform coverage. The skeptical pass rejected broad host/UI unification as unnecessary and retained the narrow corrections above.

Next execution scope: [revised milestone plan](../superpowers/plans/2026-10-13-rt3-next-steps.md).
