# Integration fix: deterministic source build identity

Fixed the isolated generator finding in identity-fix.md: ignored Python bytecode in one checkout changed its release ID despite identical actual source. The generator now traverses only source directories, skips __pycache__, .cache, node_modules, dist and build subtrees before reading their contents, and hashes recognized source extensions plus extensionless helpers. Bytecode/maps/native binaries are excluded. Generated notification TypeScript, JSON assets and new untracked source are retained. Source paths are normalized to slash separators and filenames sorted by deterministic lexical comparison. A callable sourceBuildIdentity(root) seam permits isolated verification; the existing command writes identity only under import.meta.main.

Also applied the coordinator-approved packaging change: .github/workflows/standalone.yml now supplies upload:true to the reusable build. Experimental pushes will expose native tar/checksum and .star Actions artifacts without a release/tag. Inspected reusable build's existing guarded upload steps; no public publishing change, push or CI execution was performed here.

Implementation commit: `ecb376a3dbc72a005eb6af859d97f4fa8baa00ed` (unsigned local commit, established signing-socket limitation).

Pinned Bun 1.4.3 verification:

- New fixture initially failed with missing generator export; focused generator/resolver/dependencies tests after implementation: 6 pass, 0 fail, 16 expectations.
- Fixture creates two equivalent source checkouts, adds and changes cache bytecode in one, adds standalone/dist JS, and verifies identical identities. New untracked TypeScript, an extensionless helper change, and generated notifications change each alter the ID. Cache files are not read or hashed.
- `bun run typecheck`: exit 0.
- `bun run test:standalone`: 85 pass, 0 fail; 3 contract scenarios pass, 0 fail. Output: /tmp/identity-fix-tests.log.
- `bun run build:release`: exit 0, linux-x64 baseline, GLIBC manifest requirement 2.17.
- `bun tools/test-packaged.ts`: actual compiled isolated smoke passed, including no Bun PATH, arbitrary cwd, spaces, recovery, stable invocation, embedded settings HTTP assets and uninstall preservation. Authorized escalation enabled only isolated socket fixtures.
- `bun x starlight pack -o dist`: exit 0, rebuilt .star without installation. `starlight verify`: all sections verified.
- `git diff --check`: passed.

Build ID: `684e743fee6c154bc13fdbc7354c3ab2957144315589403d60ba83de6272b2f2`.
Release artifact: `dist/releases/snn-0.1.0-684e743fee6c-linux-x64.tar.gz`.
SHA256: `f7c1ba8856bc18fd60596ad8de90f1b3d7cce53506a861c420b757da52f80ba9`.
Expanded release: `dist/releases/snn-0.1.0-684e743fee6c-linux-x64/`.
Millennium artifact: `dist/me.tysmith.steam-native-notifications.star`.
SHA256: `3bcbda98199ed2ab470e7e527ed3db4b649a199eedf503e37fba0a5d99aa2c70`.

No live actions, installation/settings/service/Steam changes, pushes or subagents. Currently installed af build remains active. Coordinator owns final review/upgrade, main frontend refresh and clean Git confirmation. No remaining blocker for this generator correction; final experimental CI upload behavior awaits its future run.

## CI regression follow-up

Added an explicit `bun test tools/gen-build-identity.test.ts` step immediately after typecheck in the reusable build workflow. This closes the review's nonblocking coverage gap. Only workflow/report files changed; package.json and identity source inputs remain unchanged, so the verified 684e743fee6c release and checksum above remain current. Inspected the exact workflow diff and ran git diff --check; no tests were repeated and no live actions or push occurred.
