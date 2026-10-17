# Standalone candidate validation

## Follow-up: explicit Millennium settings refresh

- replace periodic settings reads with one reload request after each CLI write
- distinguish saved preferences from a confirmed live reload; old or unavailable
  frontends report an unconfirmed reload rather than a failed save
- retain startup loads, immediate panel writes and existing command transport
- cover idle ticks, explicit reload, failure, expiry and CLI acknowledgement offline
- record the user's successful Steam restart and physical history-click test on
  the preceding installed candidate; no logout/login or OS-reboot claim

## Production-readiness candidate, 2026-10-17

Base: experimental after [PR #44](https://github.com/tyvsmith/steam-native-notifications/pull/44).
Build: `83a804a33ac9e80cf2a9136dff161bbb381e235ec1f0e1fbc0dc2dfc99099a5e`,
Bun 1.4.3, Starlight 1.1.6, native Linux RT3 on Hyprland.

- passed typecheck and shared regression suites, 113 standalone tests and 10
  isolated host-contract tests, nine build/publication tests, packaged Bun
  lifecycle smoke and noninstalling `.star` pack/verification
- reviewed CLI selection, logging privacy, settings refresh and publication;
  added refusal for inconclusive host probes and source identity checks for
  same-version release assets
- installed the merged baseline, then the completed candidate; package, daemon
  and frontend identities matched with hook, panel and control ready
- exercised installed CLI auto selection, config reads/writes, sample execution,
  developer opt-in/refusal, fire and replay inspection
- verified master-off capture policy preserved Steam without native delivery;
  sample execution itself remains possible through CLI under that policy
- verified safe capture summaries with verbose logging off and payload details
  only after explicit opt-in; restored configuration bytes afterward
- toggled all five native Steam controls twice, verified persisted values, and
  exercised sample, reset cancellation and removal cancellation
- confirmed removal displayed the expected success message, disabled the
  injected runtime immediately, removed service/autostart entries and preserved
  saved preferences; observed Steam's own synthetic download banner before restart
- restored setup and restarted Steam; observed an OS download banner and its
  matching Quattro record, then invoked its stored argv and confirmed exact replay
- restored DND and preferences, leaving developer/verbose flags off and the
  standalone service, hook and panel ready

Samples and download events in this pass were synthetic. The retained action
was invoked programmatically, not through a pointer click. No real game event,
logout/login, OS restart or Windows test was performed. Millennium configuration
refresh has offline coverage but was not live-tested after returning to RT3.
Personal screenshots and raw logs remain local.

## Bun distribution and settings convergence

- remove the external browser settings editor; Steam remains the settings UI
- share settings-operation serialization, stale-read protection and reset feedback between host panels
- replace compiled release deployment with a prebuilt Bun npm package and integration-only setup/teardown
- restrict automatic trusted setup to the global command; project dependency installs remain inert
- preserve package-manager ownership, preferences and disabled/stopped service state
- retain explicit teardown because Bun 1.4.3 removal does not execute package removal hooks

Offline validation uses isolated homes, fake Steam and a service-manager fixture
driving the real packaged daemon. Upgrade/downgrade and removal tests preserve
preferences and distinguish package files from owned integration.

### Installed Bun candidate, 2026-10-17

- installed build `f9bfd0b27e48c642bc879e38f139f36934a31abcba6c17d8d139247d309bb152` from the exact tested npm tarball
- saved the original compiled package and preferences locally, then uninstalled it through its own installer
- trusted global Bun installation automatically configured and started the user service
- restarted idle Steam; installed, daemon and frontend identities matched, with hook/panel/control ready
- exercised all five panel switches and reset cancellation; restored preference bytes exactly
- submitted three panel sample requests; two FriendOnline events reached capture/history, while one request had no capture event
- displayed a synthetic Aircar download-complete desktop banner; temporarily disabled DND for observation and restored it afterward
- invoked that notification's retained argv action; exact replay completed and Steam showed Aircar's library page
- validated user service and desktop-entry syntax; service active and enabled, executing the Bun-owned package

The retained action was invoked programmatically, not through a pointer click.
No real game, Millennium runtime, Windows, login or OS restart validation was
performed. Bun global commands live in `~/.bun/bin`, which was absent from this
session's PATH; the service uses absolute executable paths and is unaffected.

## Current merge checklist

The original six workstreams have landed on experimental: Steam settings UI,
shared host policy, developer tooling, Bun packaging, cleanup and documentation.
The browser editor and compiled standalone distribution are retired. Historical
entries below describe their own artifacts, not current release requirements.

| Workstream | Current implementation | Acceptance still required |
|---|---|---|
| Steam UI | shared native controls and confirmation dialogs; standalone-only removal | final candidate live results recorded below |
| Consistency | shared presentation, settings, command dispatch and diagnostic policy | Millennium external-write refresh has offline coverage; repeat live on its client |
| Developer tools | `snn` config/sample/capture/dev commands for both hosts; thin repository wrappers | same final candidate checks; no separate CLI migration |
| Packaging/install | Bun-owned application, per-user setup/teardown, explicit registry workflow | npm package ownership/trusted publisher setup before publication |
| Polish/cleanup | verbose payloads off by default; external browser editor removed | inspect old opt-in logs before sharing |
| Documentation | one current checklist with build-specific records | record deferred session/hardware results when performed |

User testing after the earlier records established standalone delivery on the
non-RT3 client, repeated notifications during gameplay, and repaired Millennium
sample/settings behavior. Those reports are user observations, not automated
proof for the current candidate. [PR #44](https://github.com/tyvsmith/steam-native-notifications/pull/44)
converged the panel and repaired Millennium bindings and settings snapshots.

### Deferred acceptance and release-owner tasks

- verify logout/login, OS restart and desktop-session environment recovery
- verify a real notification event on the final candidate; the user reported a
  successful physical history click after Steam restart on the preceding build
- cover Gamescope and compositor reconnect separately from ordinary gameplay
- repeat Millennium live regression for the new external-write refresh when its
  client is installed; do not switch clients solely for this RT3 pass
- keep Windows hardware/focus work separate; standalone is Linux x64 only
- resolve the older Windows blockers in the public-release tracker explicitly
  before describing a release as cross-platform production-ready
- configure npm ownership and trusted publishing, then explicitly run publication
- treat Millennium store listing and AUR packaging as separate distribution work

A main-branch merge does not publish a numbered release or certify deferred
platform behavior. Public-release tracking remains in
[issue #30](https://github.com/tyvsmith/steam-native-notifications/issues/30).
No release, registry version or store listing is created by this checklist.

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

## Push runtime follow-up

- replace idle configuration, panel, command, click and health polling with push
- cover idle silence, external atomic config replacement, watcher failure,
  context replacement, startup disconnect and panel reply ordering in fixtures
- verify Millennium request/reply transport against a stub MEP server and the
  SDK source; live Millennium push remains unverified
- keep earlier live results scoped to their installed builds; this follow-up
  has not been installed or tested against live Steam
