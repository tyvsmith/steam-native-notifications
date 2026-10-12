# Integration fix: optional Wayland diagnostic

Fixed only the new live-integration finding described in live-fix.md. Bun 1.4.3 refuses dlopen with an empty symbol table, so the old optional dependency probe always reported false. It now resolves the documented wl_display_disconnect client symbol (pointer argument, void return), never invokes it, never connects to the compositor, and closes its handle. Missing library or unresolved symbols still return false without throwing. No other product behavior changed.

Implementation commit: `e3f6cf5694c42a7b52eafabd1f7691d128c1a1be` (local unsigned, consistent with prior 1Password signing-socket limitation).

Verification using pinned `/home/ty/.local/share/mise/installs/bun/1.4.3/bin/bun`:

- Regression test initially failed with missing probe export; after implementation `bun test standalone/dependencies.test.ts`: 3 pass, 0 fail, 6 expectations. Tests verify a real nonempty FFI signature plus handle closure without invoking any symbol, missing-library handling, and the actual installed libwayland-client.so.0 load (not skipped on this machine).
- `bun run typecheck`: exit 0.
- `bun run build:release`: exit 0; linux-x64 baseline compiled, GLIBC manifest requirement 2.17.
- Read-only rebuilt compiled `snn doctor --json`: exit 0, required notify-send/gdbus/curl true, optional luajit/libwayland true, delivery/focus available. Host discovery was unavailable in sandbox; this does not claim live attachment or functional compositor focus.
- `bun tools/test-packaged.ts`: passed actual extracted compiled executable, no Bun PATH, arbitrary cwd, spaces, install recovery, stable invocation, embedded HTTP settings assets and uninstall preservation. Authorized escalation permitted the isolated loopback listener; temporary HOME and fake commands only.
- `bun x starlight pack -o dist`: exit 0, local .star rebuilt without installation.

Build ID: `af7892fe4ef6f1a9bcc6cec57a7e5514798bc9007af4ffb00e77ad6075547c37`.
Artifact: `dist/releases/snn-0.1.0-af7892fe4ef6-linux-x64.tar.gz`.
SHA256: `62538f8d47fe5c76f9be198e47f7a3e9aad24fc472bcba5ac8333913a2155e28`.
Expanded release: `dist/releases/snn-0.1.0-af7892fe4ef6-linux-x64/`.
Local Millennium artifact: `dist/me.tysmith.steam-native-notifications.star`.
SHA256: `60573bf973102805340143b388bcc040fd59c58d113b21eccf70e2ff2b6fad39`.

No live edits/install/service/settings/Steam actions, push, or subagents. Coordinator owns review/upgrade of the currently installed 082 build and pending Steam restart coordination. No remaining blocker for this probe correction.
