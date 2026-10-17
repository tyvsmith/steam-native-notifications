# RT3 candidate validation

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
