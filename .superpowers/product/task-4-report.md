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
