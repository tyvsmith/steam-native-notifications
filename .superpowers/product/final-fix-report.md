# Final narrow runtime-path correction

Implemented the single P2 finding in final-review.md. Bun source execution no longer depends on the executable basename: the resolver uses the module's compiled `$bunfs` namespace to select packaged mode. Source mode resolves the checkout parent, with Windows drive/UNC path semantics. Compiled mode retains realpath(process.execPath), preserving physical version assets through stable symlinks. Common Millennium capture therefore receives the checkout tools/capture entry during source execution, including bun.exe and renamed POSIX Bun.

Implementation commit: `7cc460080ae7a6a046c3107f03ceca1b71a80d5c`.

Verification with `/home/ty/.local/share/mise/installs/bun/1.4.3/bin/bun` (Bun 1.4.3):

- New test initially failed with missing resolver export (0 pass, 1 fail, 1 error); after implementation, runtime-path and capture tests: 17 pass, 0 fail, 22 expectations. Covers POSIX Bun, renamed POSIX runtime, Windows bun.exe source root and real physical compiled snn root through a symlink.
- `bun run typecheck`: exit 0.
- `bun run test:standalone`: 82 pass, 0 fail; 3 contract scenarios pass, 0 fail. Full output retained at `/tmp/final-fix-tests.log`.
- `bun run build:release`: exit 0, native linux-x64 baseline executable built; manifest GLIBC requirement 2.17.
- `bun tools/test-packaged.ts`: passed actual extracted compiled executable, no Bun on PATH, arbitrary cwd, paths with spaces, fake Steam/systemctl/dependency commands, install recovery, stable invocation, embedded settings HTTP assets, uninstall/settings preservation. Required authorized escalation for loopback binding after sandbox-only run could not obtain settings URL; the isolated fixture passed with loopback access.
- `bun x starlight pack -o dist`: exit 0; rebuilt Millennium .star without installation.

Build ID: `082dfd8ab100dc85824163b63697ebf0a7e10182bf86f62ea6eee458ef6a5828`.

Release artifact: `dist/releases/snn-0.1.0-082dfd8ab100-linux-x64.tar.gz`.
SHA256: `6d465884dc093a3c8e1182ff65f47fff7f6dfd5f38ad3681340bf460c3371e35`.
Expanded release: `dist/releases/snn-0.1.0-082dfd8ab100-linux-x64/`.
Millennium artifact: `dist/me.tysmith.steam-native-notifications.star`.
SHA256: `af3718f72c51542aeece01b2b134ac61738fbf17e1c0f52e4b7a8e36b0696242`.

No live Steam/service/settings/installation or push actions. Windows resolver coverage is a path fixture, not Windows execution. Local commit signing failed because 1Password's socket was unavailable; the explicit implementation commit was made with signing disabled. Artifacts remain available to the coordinator. No remaining blocker for this narrow fix.
