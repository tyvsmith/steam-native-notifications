# RT3 candidate validation

## Bun distribution and settings convergence

- remove the external browser settings editor; Steam remains the settings UI
- share settings-operation serialization, stale-read protection and reset feedback between host panels
- replace compiled release deployment with a prebuilt Bun npm package and integration-only setup/teardown
- restrict automatic trusted setup to the global command; project dependency installs remain inert
- preserve package-manager ownership, preferences and disabled/stopped service state
- retain explicit teardown because Bun 1.4.3 removal does not execute package removal hooks

Validation uses isolated homes, fake Steam and a service-manager fixture driving
the real packaged daemon. It establishes package and control behavior, not live
Steam delivery or graphical-session recovery. The currently installed compiled
candidate is unchanged. No Windows, Millennium runtime, login or OS restart
validation was performed for this change.

## Experimental merge checklist

Each milestone targets `experimental/rt3-standalone-cdp`, receives independent
review and CI, then merges. Main remains gated on the deferred host/session
checks below. The Bun package supersedes compiled standalone distribution;
older evidence below describes the artifacts tested at that time.

| Milestone | Plan and maintainability checkpoint | Verification and evidence |
|---|---|---|
| 1. Steam UI | exercise existing panel and notification journeys; keep one shared notification pipeline | [PR #32](https://github.com/tyvsmith/steam-native-notifications/pull/32): panel controls and sample, exact build readiness, stored-argv fallback after Steam restart; build-specific evidence below |
| 2. Consistency | parse quoted VDF values correctly; pin editor storage to the daemon-advertised configuration path or initial offline default | [PR #34](https://github.com/tyvsmith/steam-native-notifications/pull/34): account-selection and alternate-config regression fixtures, shared suites |
| 3. Developer tools | fingerprint semantic build inputs; use one identity generator, no extra version registry | [PR #33](https://github.com/tyvsmith/steam-native-notifications/pull/33): identity sensitivity and deterministic generation fixtures; integrated pack checks complete |
| 4. Packaging/install | gate compiled-binary publication; preserve one per-user installer and explicit local packages | [PR #35](https://github.com/tyvsmith/steam-native-notifications/pull/35): publication guard, release matrix and package fixtures; runtime redistribution materials remain incomplete |
| 5. Polish/cleanup | bundle a typed browser editor with ordinary imports; remove unused model and obsolete reports | [PR #36](https://github.com/tyvsmith/steam-native-notifications/pull/36): typed editor behavior, compiled assets and shared regression checks |
| 6. Documentation/final audit | reconcile support and exact-build evidence here; retain one authoritative readiness checklist | final integrated package/live evidence below; diagnostic skills checked against current transport and commands |

### Deferred acceptance

- run Millennium live regression on the non-RT3 client: settings actions,
  external updates, fresh readiness and correlated command success/failure/expiry
- verify real logout/login, OS restart and desktop-session environment recovery
- retain Windows behavior as explicitly untested by this workstream
- verify retained-history pointer clicks, real notification events and
  in-game/Gamescope behavior where unavailable in the final pass
- publish registry versions only through an explicit release operation; the new
  Bun package does not embed the runtime covered by the former binary audit

Synthetic events, fixture interruption, stored-argv invocation and helper
acknowledgement each establish only their own layer. They do not prove real
server events, power-loss durability, physical history clicks or visible banners.

## Toast lifecycle and immediate tests, 2026-10-17

Build: `aa865e733f5df3601b96b7f91eef33991899fabfaf3fd7e5ae83f46889bfe7c5`,
version 0.1.0, native Linux RT3.

- found two already-closed synthetic popups retained in Steam's animation state,
  blocking 18 queued notifications; native dismissal of only those two objects
  preserved the queue and allowed it to drain without restarting
- replaced raw CEF window closure with the matching toast's native dismissal;
  the original animation exception was not retained, so its exact failing
  instruction remains unconfirmed
- reproduced an immediate master-on/test race: saved settings had changed while
  the capture snapshot still disabled OS delivery; commands now apply fresh
  saved settings before execution, and delayed polling cannot overwrite them
- passed shared tests, 114 standalone tests plus four contracts, noninstalling
  Millennium pack and compiled package smoke; fixtures cover callback binding,
  failure without force-close, deferred acknowledgement and config races
- installed the exact final package after checking no game or queued notification
  remained; installed, daemon and frontend identities matched
- verified three replacement downloads, a master-off native toast, and three
  resumed samples; each phase drained Steam's queue, rendering contexts and popups
- repeated three immediate master-on/test clicks through the actual panel; all
  three captured with OS delivery enabled and reached desktop notification history
- confirmed the desktop's Do Not Disturb was on and left it unchanged; silent
  history delivery was expected, and this pass makes no OS-banner visibility claim
- restored the user's current configuration byte-for-byte, including enabled
  desktop Steam notifications; no Millennium, Windows or OS-session live tests

## Integration switch, 2026-10-16

Build: `20847ff6b68b582de873f16dc95d52812a02603f1c27f32d13eae44c07fda4e2`,
version 0.1.0, Bun 1.4.3, native Linux RT3 on Hyprland.

- flattened all three editors to Operating system notifications; Linux shows
  the master followed by game OS/Steam and desktop OS/Steam switches
- passed shared tests, 110 standalone tests plus four host contracts,
  noninstalling Millennium pack and compiled package smoke; a subsequent
  external-editor fixture also verified the five-switch order and disabled state
- verified native Steam content, each context switch, reset cancel/confirm,
  navigation away/back and sample execution with developer options disabled
- disabled the master through the panel; attempted subordinate clicks left
  preferences unchanged and Steam's native disabled style covered the rows and
  test button; re-enabling restored the saved choices
- observed capture policy change from `sendNative:false, showSteam:true` to
  `sendNative:true, showSteam:false`; saw the resumed OS download banner
- covered no native delivery and no Steam window closure across both capture
  contexts in runtime fixtures; repeated live native-toast screenshots were
  inconclusive, so the off-state visibility claim remains limited to policy logs
- opened and dismissed the existing native dropdown without changing it;
  installed, daemon and frontend identities matched after the authorized restart
- restored the original configuration byte-for-byte, including the absent master
  key, which normalizes to enabled; no Millennium, Windows or OS-session live tests

## Notifications section, 2026-10-16

Build: `c7eab5b6d9d447603be0d7f07b6de26a6bce7f99592da06d5ea1962ac6e0258c`,
version 0.1.0, Bun 1.4.3, native Linux RT3 on Hyprland.

- moved standalone controls into Desktop notifications at the bottom of Steam's
  existing Notifications page; removed the custom sidebar page and divider
- preserved the original notification text and all 16 native toggle controls;
  verified one appended section as the last child of the same native scroll body
- verified all four extension toggles, scoped reset cancel/confirm, external
  settings updates, navigation away/back and fixed sample execution
- opened and dismissed Steam's existing toast dropdown without changing its
  selection; closing and reopening Settings retained exactly one section
- passed shared and standalone tests, noninstalling Millennium pack and compiled
  package smoke; seam fixtures cover stable wrappers, native props/children,
  unsupported shapes, duplicate/missing pages and extension-only error isolation
- upgraded and restarted Steam after checking for running games; installed,
  daemon and frontend identities matched, with hook, section and control ready
- restored preferences byte-for-byte; screenshots of the settings window showed
  the section following Steam's Email Opt-out controls with no extra sidebar item

This pass validates settings placement and sample execution. It adds no new
physical-click, real-event, game, Millennium, Windows or OS-session evidence.

## Integrated candidate, 2026-10-16

Runtime source: experimental commit `00a7dfc5fdad46f10c0bfa2a9094617a5868a5ea`.
Build: `a612f12d1cdae4a4b7479ce6303f1399798e10045f5914bb3086702169ca03d7`,
version 0.1.0, Bun 1.4.3, native Linux RT3 on Hyprland.
Later documentation-only commits do not change this runtime identity; the local
installed archive contains the documentation snapshot packaged for this test.

- built the compiled release, ran the full shared regression suite and packed
  Millennium into `dist` without installing it
- passed 106 standalone tests and four host-contract fixtures; compiled smoke
  exercised install, settings assets and uninstall without Bun on PATH
- upgraded the installed package and fully restarted Steam after checking for
  running games; installed, daemon and frontend identities matched
- verified all four Steam panel toggles, reset cancel/confirm, external updates,
  navigation away/back and fixed sample with developer controls disabled
- used the bundled typed browser editor to save and restore a preference and
  execute its fixed sample; reloaded after daemon restart, then closed its server
- confirmed hook, panel and control readiness after daemon-only restart
- observed the synthetic Aircar download banner with artwork
- invoked the fixed argv retained from the earlier candidate; the restarted
  client logged accepted activation, missing stash and durable desktop dispatch
  to Aircar; screenshots showed Dota 2 before invocation and Aircar afterward
- kept stored-action invocation separate from a physical history click
- restored original preferences byte-for-byte and left Steam and the service ready

The native UI automation surface was unavailable for a fresh physical click.
The earlier candidate's banner-click result remains separate evidence. No
Millennium, Windows, OS restart, logout/login, real-event or in-game validation
was performed in this pass. Personal screenshots and logs remain local.

## Convergence candidate, 2026-10-16

Candidate: `8ddfe1e0d452047299845d1e8e7acb7a0b46b006a14aab6c51095e5152c897e8`,
version 0.1.0, Bun 1.4.3, native Linux RT3 on Hyprland.

- installed the compiled package and restarted Steam; installed, daemon and frontend identities matched
- verified hook, panel and control readiness again after a daemon-only restart
- exercised all four panel toggles, reset cancel/confirm, external updates and navigation away/back
- executed the fixed panel sample with developer settings disabled
- saved and restored a browser-editor preference, executed its sample, reloaded after daemon restart and closed the editor server
- observed the synthetic Aircar download banner with artwork; a pointer click from a non-Steam window reached the canonical URL, replayed the captured handler, focused Steam and displayed Aircar's library page
- restored the original preferences byte-for-byte; left the installed service ready
- retained screenshots and personal notification logs locally

Millennium live parity remains blocked: no installed loader was found and its
external protocol socket was absent. Offline tests and the noninstalling pack
do not establish live FFI compatibility. Its panel actions, external updates,
fresh readiness and correlated success/failure/expiry still need a live host.

### Follow-up after experimental merge, 2026-10-16

- captured a fresh synthetic Aircar notification in Quattro history, stopped Steam completely, then relaunched it
- confirmed the same installed, daemon and frontend identity with hook, panel and control ready
- invoked the exact fixed argv retained by Quattro; the log showed the missing replay stash, then durable dispatch to `steam://nav/games/details/1073390`
- observed Aircar's library page after dispatch; this exercised stored-argv activation, not a pointer click in the history UI
- repeated all four panel toggles, reset cancel/confirm, external updates, navigation and the fixed sample with developer settings disabled
- restored preferences byte-for-byte and left Steam and the standalone service ready

Remaining release evidence: a retained-history pointer click after Steam restart,
real events, in-game/Gamescope behavior, compositor reconnect, logout/login,
and complete runtime redistribution materials. Millennium, Windows, OS restart
and logout/login checks are explicitly deferred. The immediate banner click and
stored-argv fallback establish separate parts of the notification journey.

## Earlier candidate, 2026-10-15

Candidate: `a2efd134a9552b12507d63af70237e4dfc210a3ee674c1c92e048907a2fe187c`,
version 0.1.0, Bun 1.4.3, native Linux RT3 on Hyprland.

### Historical compiled-candidate milestones

| Milestone | Current result | Remaining gate |
|---|---|---|
| Steam UI | user accepted native styling, icon and bottom separator; revalidated after upgrade | private Steam UI compatibility across updates |
| Consistency | shared context/visibility/reset policy; stale responses and expired editor sessions handled | live Millennium parity remains separate |
| Developer tools | option-order parity, explicit host selection, human/JSON output, backend readiness distinguished | broader host compatibility |
| Packaging/install | executable/protocol checks, PID/build readiness, stopped/disabled preservation, recoverable upgrades, Steam-independent uninstall | real logout/login coverage |
| Polish/cleanup | normalized XDG paths, bounded private logs, reviewed async state handling | external editor layout review on other desktops |
| Documentation | package instructions and notice audit included; development setup labeled | public redistribution materials and final release approval |

### Evidence

- typecheck and normal backend/frontend regression suite passed; Millennium pack written to `dist`, without installing it
- standalone tests: 101 passed, plus 3 isolated host contract tests
- compiled smoke passed with no Bun on PATH, arbitrary working directory and paths containing spaces; exercised install, responsive daemon waiting for Steam, equivalent doctor option orders, editor assets and uninstall
- installer fixtures covered all enabled/active combinations, wrong PID/build/protocol, missing socket, immediate failure, readiness rollback and repeated interruption recovery
- desktop-file-validate and systemd-analyze --user verify accepted the installed entries
- live upgrade preserved preferences and reported verified daemon activation; stale injected frontend correctly disabled sample/developer capabilities until Steam restarted
- after restart, daemon, installed and frontend identities matched; hook, panel and control reported ready
- daemon-only restart reattached to the existing frontend with hook and panel still installed
- all four presentation toggles persisted; reset cancel preserved values, confirmed reset restored defaults, external writes appeared in the panel, and navigation away/back worked
- fixed sample executed with devMode and devFire disabled; desktop screenshot showed its banner, independently of the execution acknowledgement
- synthetic download-complete banner displayed the Aircar artwork and copy; pointer attempts did not establish click delivery, so no live-click success is claimed
- temporary preferences restored; raw personal notification logs/screenshots remain local and are not included here

### Outstanding evidence at that time

- verify a banner click from a neutral window and a retained history click after Steam restart, including visible destination and focus
- verify real download/social events, in-game behavior, Gamescope, compositor reconnect and logout/login where available
- assemble complete pinned Bun/runtime notices and rebuild/relink materials before public binary distribution

Fixtures, protocol invocation and helper acknowledgement do not replace these
visible user journeys. This is a local test candidate, not a release-readiness claim.
