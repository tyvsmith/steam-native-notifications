# Task 4 release/install/migration report

Implemented native Linux x64 release packaging in the isolated product checkout. No live Steam/service/settings/desktop changes, pushes, tags, public releases or subagents.

## Deliverables and APIs

`standalone/product.ts` compiles one dispatcher with install, upgrade, rollback, recover, uninstall, session, daemon, status, doctor, settings, capture, dev fire, --help, --version and --json. Daemon exports `daemonMain()`, source setup exports `setupMain()` and `desktopQuote()` while retaining source behavior/tests. No config CLI. Settings assets embed automatically by imports; real compiled page assets verified.

`runtimeRoot()` and `runtimeAsset()` resolve realpath(process.execPath) for compiled mode, so helpers/bundle/build metadata anchor the physical version behind active/bin symlinks. Source mode retains checkout paths. Host delivery/focus, daemon frontend, control installed-build metadata and Millennium capture entry use this resolver.

`installPackage(paths, extractedRelease, steamOption, runner?)`, `packageCommand(command,args,paths?,runner?)`, `recover(paths,runner)` expose fixture seams. `validateRelease()` validates exact asset inventory, regular files/no links/special files/foreign directories, every SHA256, manifest version/build identity and frontend identity. Release manifest includes pinned compiler, target and measured ELF GLIBC requirement. Dependencies report required delivery tools and optional LuaJIT/libwayland focus availability.

Versioned XDG data assets and stable ~/.local/bin/snn are managed with exact symlink targets. Unit/autostart and discoverable XDG applications Settings entry have inode/device/content ownership. Existing v1 state migrates directly only after freshly derived paths/native Steam root and unchanged owned service/autostart records validate. Duplicate/malformed/unowned/modified records refuse before service commands. Config bytes, unknown keys and original marker record are retained; new defaults disable devFire/devMode. Shared config/marker remain on uninstall.

Upgrade accepts only explicitly supplied extracted local release; atomic active switch retains previous versions. Rollback validates previous release. Before any managed switch, persistent transaction stores old bytes/modes/link targets and permitted replacement hashes. Service failure restores old state/files/link, refreshes inode ownership and restarts previous daemon. Recovery is retryable after manager failure; edited recovery targets remain preserved. Tests cover every switch prefix (unit/autostart/desktop/active/bin/state) using interrupted fixtures. Old injected frontend identity is unchanged by daemon upgrade/rollback and continues to report restart-needed until user restarts Steam.

CI pins Ubuntu22.04/Bun1.4.3, builds/tests native tarball plus .star; uploads tar/checksum, enforces package/TOML/tag equality and preserves dry_run. Documentation: docs/standalone-release.md.

## Exact final artifact

- Version: 0.1.0; protocol 1.
- Build ID: `2d13607ded48fa337be41f8fc8412592a46881de594f242cfedfcd9817b8fbec`.
- Extracted package: `/home/ty/Documents/Codex/2026-10-10/task-4/product-build/dist/releases/snn-0.1.0-2d13607ded48-linux-x64`.
- Tarball: same directory parent, `snn-0.1.0-2d13607ded48-linux-x64.tar.gz`.
- Checksum companion: `.tar.gz.sha256`.
- SHA256: `78a7cd82beea712999f057ce718e7407334a61d6c67385a06c4aead2218bb8bb`.
- ELF GLIBC maximum symbol version: 2.17. Conservatively supported CI distro floor Ubuntu22.04/glibc2.35; execution on older distros unverified.
- Local .star: `dist/me.tysmith.steam-native-notifications.star`, 94.89kB, packed after final identity generation, installed nowhere.

Coordinator command from graphical desktop terminal (replace Steam directory with already selected canonical native root):

```sh
release=/home/ty/Documents/Codex/2026-10-10/task-4/product-build/dist/releases/snn-0.1.0-2d13607ded48-linux-x64
"$release/snn" install --release "$release" --steam-dir "/selected/native/Steam"
~/.local/bin/snn doctor --json
~/.local/bin/snn status --json
~/.local/bin/snn settings
```

Future upgrades: `snn upgrade --release /explicit/extracted/package`; rollback `snn rollback`; interrupted activation `snn recover`; uninstall `snn uninstall`. None launches/stops Steam.

## Verification

Bun executable `/home/ty/.local/share/mise/installs/bun/1.4.3/bin/bun`.

- Final `bun run build:release` passed: frontend/typecheck, pinned baseline native compile, inventory validation, readelf and tar/checksum.
- Final installer suite: **8 passed, 62 assertions**. Clean install, config/marker bytes+ownership, source migration, malformed/duplicate/unowned records, modified service/assets, upgrade/rollback, failed service restart restoration, retryable recovery, modified recovery preservation, every switch prefix, uninstall collision/modified/foreign assets and shared-file preservation.
- Final `bun tools/test-packaged.ts` passed: actual compiled executable in copied extracted directory, fake Steam/systemctl/dependency commands, no Bun on PATH, arbitrary cwd, home/release/Steam paths with spaces, stable symlink invocation, embedded settings HTTP HTML/CSS/JS, modified settings preserved after uninstall.
- `bun run test` passed with isolated fixture escalation; log `/tmp/task4-full-tests-escalated.log`. Initial restricted sandbox EPERM failures were fixture socket restrictions, superseded by successful rerun.
- `bun run test:standalone` passed: **74 tests/343 assertions plus 3 contract scenarios/25 assertions**, log `/tmp/task4-standalone-tests-escalated.log` (before final extra installer cases; those rerun separately).
- Final affected host/source setup/settings server/browser suites: **36 passed/174 assertions**, `/tmp/task4-affected-final.log`.
- Final local Millennium pack passed; `git diff --check` passed.

## Limits and recovery notes

Live installation/runtime, desktop entry visibility, Steam frontend reload and UI notification delivery remain coordinator validation. CI workflow itself was not dispatched; Ubuntu22.04 execution remains CI evidence when it runs. Compiler baseline runtime download used approved network access once; end-user installers never download anything.

Interrupted setup directory lock requires explicit removal after confirming no setup process remains; it uses the same state.lock name as source setup to prevent overlapping source/product mutation. A crash before transaction persistence may leave an unreferenced stage/version directory: it is never claimed/deleted automatically and identical identity collision refuses; inspect/remove it manually. This case and retryable recovery commands are documented. Version directories are not removed while ordinary upgrade/rollback occurs. All shared preferences and marker are preserved on uninstall, including created config, to avoid deleting useful preferences.

Integrity checks do not authenticate publishers. No auto-release download or OS package installation. Native Linux only; Flatpak unsupported. Checks establish fixture/artifact behavior, not live Steam or other-platform behavior.

## Task 4 review corrections — 2026-10-12

Resolved all four findings in task-4-review.md; the artifact below supersedes the earlier package.

1. Fresh-install recovery disables/stops the validated new unit before restoring its absent snapshot. Manager completion is journaled before any unit removal, allowing repeat recovery after unit deletion without a nonexistent-unit disable. Strict runner and real compiled command fixtures model systemctl failure when the unit is missing, first-install restart failure and subsequent extracted recovery.
2. Refreshed old-state bytes are permitted in the durable transaction before atomic state publication. Recovery accepts original, desired installation and expressly permitted refreshed bytes; publication-before-snapshot-commit interruptions converge without manual journal edits. Subsequent installation succeeds.
3. Recovery records a fully validated cleanup plan before removing a release. Each regular file has device/inode/checksum ownership, and directories are bounded to that release. Resumption validates all remaining entries, accepts already absent planned files/directories and refuses unknown or changed assets. No recursive deletion remains in transactional release cleanup. Interruption midway through deletion or after release disappearance before transaction unlink resumes safely.
4. Uninstall persists its owned snapshots (including inode identity), release removal plans and manager phase before mutation. Repeated uninstall or recover from an extracted executable resumes after unit/bin/active/state unlink or partial release deletion. Every remaining target is checked before service or removal commands. Settings and marker remain preserved.

`recover(paths,runner,checkpoint?)` and `packageCommand(command,args,paths?,runner?,checkpoint?)` expose an optional fixture-only observer for actual durable boundaries; no environment or public CLI option enables it. Failure injection runs after every recovery restoration, manager phase, refreshed-state permission/publication/snapshot commit, cleanup-plan publication, file deletion, directory deletion and pre-transaction unlink; uninstall injection covers journal creation, manager operation/publication, every managed unlink, each file/directory deletion and final reload. Both fresh and previous-install recovery are covered. Partial removal safety includes changed/foreign asset preservation.

Verification with pinned Bun1.4.3:

- Focused installer suite: **12 passed, 479 assertions**; all durable recovery/removal/uninstall interruption prefixes and all original migration/upgrade/rollback tests.
- `bun run typecheck` and final `bun run build:release`: passed; regenerated frontend identity, compiled Linuxx64 baseline, manifest/inventory/checksums/tar and readelf GLIBC2.17 requirement.
- Final compiled `tools/test-packaged.ts`: passed, now additionally models first-install restart failure and missing-unit disable failure, requires automatic recovery to clear its journal, then runs extracted recover and successful install. Existing no-Bun PATH/arbitrary cwd/spaces/stable link/embedded settings HTTP/uninstall preservation checks remain.
- Source setup compatibility: **16 passed, 85 assertions**, `/tmp/task4-review-source-setup.log`.
- Full standalone regression: **80 passed, 793 assertions plus 3 contract scenarios/25 assertions**, `/tmp/task4-review-standalone.log` (isolated fixture socket escalation).
- Final local Millennium pack passed, 94.89kB; `git diff --check` passed. Unaffected backend/tool broad suite was not repeated; its earlier passing evidence remains.

Final replacement version 0.1.0/protocol1 identity: `7f1a5440452322203a8e6fcca372d154f43e36faf3c7f1e01f312c26a96f4320`.

Extracted release: `/home/ty/Documents/Codex/2026-10-10/task-4/product-build/dist/releases/snn-0.1.0-7f1a54404523-linux-x64`.

Tarball: `dist/releases/snn-0.1.0-7f1a54404523-linux-x64.tar.gz`; companion `.tar.gz.sha256`; SHA256 `9f825c9a9b5f038b80b0f15e56758a5fbab2b70e30fc0fe3f30fdb93990fb026`.

Coordinator install command uses this new extracted directory with the previously selected canonical native Steam directory. Interrupted uninstall recovery can use `"/explicit/extracted/release/snn" recover` when the stable entrypoint has been removed. No live operations, Steam commands, pushes, releases, tags or subagents were performed. Coordinator scoped review and live validation remain outstanding.
