# RT3 candidate validation

## Experimental merge checklist

Each milestone targets `experimental/rt3-standalone-cdp`, receives independent
review and CI, then merges. Main remains gated on the deferred host/session
checks below. Public standalone binary distribution is a separate gate.

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
- keep standalone release uploads disabled until complete pinned-runtime
  notices and rebuild/relink materials are reviewed

Synthetic events, fixture interruption, stored-argv invocation and helper
acknowledgement each establish only their own layer. They do not prove real
server events, power-loss durability, physical history clicks or visible banners.

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

### Milestones

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
