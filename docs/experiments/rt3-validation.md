# RT3 candidate validation, 2026-10-15

Candidate: `a2efd134a9552b12507d63af70237e4dfc210a3ee674c1c92e048907a2fe187c`,
version 0.1.0, Bun 1.4.3, native Linux RT3 on Hyprland.

## Milestones

| Milestone | Current result | Remaining gate |
|---|---|---|
| Steam UI | user accepted native styling, icon and bottom separator; revalidated after upgrade | private Steam UI compatibility across updates |
| Consistency | shared context/visibility/reset policy; stale responses and expired editor sessions handled | live Millennium parity remains separate |
| Developer tools | option-order parity, explicit host selection, human/JSON output, backend readiness distinguished | broader host compatibility |
| Packaging/install | executable/protocol checks, PID/build readiness, stopped/disabled preservation, recoverable upgrades, Steam-independent uninstall | real logout/login coverage |
| Polish/cleanup | normalized XDG paths, bounded private logs, reviewed async state handling | external editor layout review on other desktops |
| Documentation | package instructions and notice audit included; development setup labeled | public redistribution materials and final release approval |

## Evidence

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

## Outstanding release evidence

- verify a banner click from a neutral window and a retained history click after Steam restart, including visible destination and focus
- verify real download/social events, in-game behavior, Gamescope, compositor reconnect and logout/login where available
- assemble complete pinned Bun/runtime notices and rebuild/relink materials before public binary distribution

Fixtures, protocol invocation and helper acknowledgement do not replace these
visible user journeys. This is a local test candidate, not a release-readiness claim.
