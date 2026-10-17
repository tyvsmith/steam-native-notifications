/** Exercise the actual npm tarball in isolated Bun global homes. */
import { mkdtemp, mkdir, writeFile, chmod, readFile, rm, realpath, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { ASSETS, sha256, validateRelease } from '../standalone/package-manifest';
const identity = JSON.parse(await readFile('shared/build-identity.json', 'utf8'));
const name = `snn-${identity.version}-${identity.buildId.slice(0, 12)}`;
const archive = resolve('dist/releases', `${name}.tgz`);
const home = await mkdtemp(join(tmpdir(), 'snn bun package spaces '));
const env = { ...process.env, HOME: home, BUN_INSTALL: join(home, '.bun'), XDG_CONFIG_HOME: join(home, 'config'), XDG_DATA_HOME: join(home, 'data'), XDG_STATE_HOME: join(home, 'state'), XDG_CACHE_HOME: join(home, 'cache'), XDG_RUNTIME_DIR: join(home, 'run'), DISPLAY: '', WAYLAND_DISPLAY: '', DBUS_SESSION_BUS_ADDRESS: '', PATH: `${dirname(process.execPath)}:/usr/bin:/bin` };
async function call(args: string[], expected = 0, cwd = home) {
    const child = Bun.spawn(args, { cwd, env, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code !== expected) throw new Error(`${args.join(' ')}: ${code} ${stderr} ${stdout}`);
    return stdout;
}
try {
    await call([process.execPath, 'add', '-g', '--trust', archive]);
    const root = join(home, '.bun/install/global/node_modules/@tyvsmith/steam-native-notifications');
    await validateRelease(root);
    const bin = join(home, '.bun/bin/snn');
    if (await realpath(bin) !== join(root, 'standalone/cli.js')) throw new Error('Global executable link differs');
    await call([bin, '--help']);
    await call([bin, 'daemon', '--help']);
    // No display/session is present: a trusted hook must not create user integration.
    if (await Bun.file(join(home, 'config/systemd/user/steam-native-notifications-standalone.service')).exists()) throw new Error('Headless installation configured desktop integration');
    await call([process.execPath, 'run', 'preuninstall'], 0, root);
    if (await Bun.file(join(home, 'config/systemd/user/steam-native-notifications-standalone.service')).exists()) throw new Error('Unowned uninstall hook created integration');
    await call([process.execPath, 'remove', '-g', '@tyvsmith/steam-native-notifications']);
    const steam = join(home, 'data/Steam');
    await mkdir(join(steam, 'steamrt64'), { recursive: true });
    await writeFile(join(steam, 'steam.sh'), ''); await writeFile(join(steam, 'steamrt64/steam'), '');
    const shims = join(home, 'fake commands'); await mkdir(shims);
    await mkdir(env.XDG_RUNTIME_DIR, { mode: 0o700 });
    for (const name of ['notify-send', 'gdbus', 'curl']) {
        await writeFile(join(shims, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    }
    await writeFile(join(shims, 'systemctl'), `#!/bin/sh
printf '%s\\n' "$*" >> "$HOME/systemctl.log"
case "$2" in
 restart)
  if test -f "$HOME/daemon.pid"; then
   old=$(cat "$HOME/daemon.pid"); kill "$old" 2>/dev/null || true
   remaining=70
   while kill -0 "$old" 2>/dev/null; do
    case "$(ps -o stat= -p "$old")" in Z*|"") break;; esac
    test "$remaining" -gt 0 || exit 1
    remaining=$((remaining - 1)); sleep 0.1
   done
  fi
  "$BUN_INSTALL/bin/snn" daemon --steam-dir "$XDG_DATA_HOME/Steam" --port 1 >"$HOME/daemon.log" 2>&1 &
  echo $! > "$HOME/daemon.pid";;
 show)
  echo UnitFileState=enabled; echo ActiveState=active; echo SubState=running
  if test -f "$HOME/daemon.pid"; then echo "MainPID=$(cat "$HOME/daemon.pid")"; fi;;
 disable|stop) if test -f "$HOME/daemon.pid"; then kill "$(cat "$HOME/daemon.pid")" 2>/dev/null || true; fi;;
esac
exit 0
`);
    await chmod(join(shims, 'systemctl'), 0o755);
    env.PATH = `${shims}:${env.PATH}`; env.DISPLAY = ':fixture'; env.DBUS_SESSION_BUS_ADDRESS = 'unix:path=/fixture';
    await call([process.execPath, 'add', '-g', '--trust', archive]);
    const unit = join(home, 'config/systemd/user/steam-native-notifications-standalone.service');
    if (!(await readFile(unit, 'utf8')).includes(join(root, 'standalone/cli.js'))) throw new Error('Trusted global hook did not configure packaged CLI');
    const status = JSON.parse(await call([bin, '--host', 'standalone', '--json', 'status']));
    if (status[0]?.build?.buildId !== identity.buildId) throw new Error('Packaged daemon build differs');
    const project = join(home, 'local project'); await mkdir(project);
    const before = await readFile(join(home, 'systemctl.log'), 'utf8');
    await call([process.execPath, 'add', '--trust', archive], 0, project);
    await call([process.execPath, 'run', 'preuninstall'], 0, join(project, 'node_modules/@tyvsmith/steam-native-notifications'));
    if (await readFile(join(home, 'systemctl.log'), 'utf8') !== before) throw new Error('Local dependency hook modified desktop integration');
    await call([bin, 'config', 'set', 'integrationEnabled', 'false']);
    const config = join(home, 'config/steam-native-notifications/standalone.json');
    const saved = await readFile(config);
    await call([process.execPath, 'add', '-g', '--force', '--trust', archive]);
    if (!(await readFile(config)).equals(saved)) throw new Error('Package reinstall changed preferences');
    // Simulate a future release without publishing it or modifying source identities.
    const future = join(home, 'future package'); await cp(root, future, { recursive: true });
    const next = { ...identity, version: `${identity.version.split('.')[0]}.${identity.version.split('.')[1]}.${Number(identity.version.split('.')[2]) + 1}`, buildId: sha256(`fixture next release:${identity.buildId}`) };
    for (const asset of ['standalone/cli.js', 'dist/standalone/frontend.js']) {
        const text = await readFile(join(future, asset), 'utf8');
        if (!text.includes(identity.buildId) || !text.includes(`version: "${identity.version}"`)) throw new Error(`Fixture identity missing in ${asset}`);
        await writeFile(join(future, asset), text.replaceAll(identity.buildId, next.buildId).replaceAll(`version: "${identity.version}"`, `version: "${next.version}"`));
    }
    await writeFile(join(future, 'dist/standalone/build.json'), JSON.stringify(next));
    const futurePackage = JSON.parse(await readFile(join(future, 'package.json'), 'utf8'));
    futurePackage.version = next.version;
    await writeFile(join(future, 'package.json'), JSON.stringify(futurePackage, null, 2) + '\n');
    const manifest = { ...await validateRelease(root), version: next.version, buildId: next.buildId, files: {} as Record<string, string> };
    for (const asset of ASSETS) manifest.files[asset] = sha256(await readFile(join(future, asset)));
    await writeFile(join(future, 'manifest.json'), JSON.stringify(manifest));
    await validateRelease(future);
    const futureArchive = join(home, 'future-release.tgz');
    await call([process.execPath, 'pm', 'pack', '--ignore-scripts', '--filename', futureArchive], 0, future);
    for (const [release, expected] of [[futureArchive, next], [archive, identity]] as const) {
        await call([process.execPath, 'add', '-g', '--trust', release]);
        const installed = await validateRelease(root);
        const running = JSON.parse(await call([bin, '--host', 'standalone', '--json', 'status']));
        if (installed.version !== expected.version || installed.buildId !== expected.buildId || running[0]?.build?.buildId !== expected.buildId || running[0]?.build?.version !== expected.version) throw new Error('Package upgrade/downgrade did not activate matching daemon');
        if (!(await readFile(config)).equals(saved)) throw new Error('Package upgrade/downgrade changed preferences');
    }
    // Bun 1.4.3 ignores declared uninstall hooks; keep this capability check explicit.
    const ownedUnit = await readFile(unit);
    await call([process.execPath, 'remove', '-g', '@tyvsmith/steam-native-notifications']);
    if (await Bun.file(join(root, 'package.json')).exists()) throw new Error('Bun removal left application files');
    if (!(await readFile(unit)).equals(ownedUnit)) throw new Error('Fixture expected Bun-only removal to leave integration');
    if (!await Bun.file(join(home, 'config/autostart/steam-native-notifications-standalone.desktop')).exists()) throw new Error('Bun-only removal unexpectedly removed autostart');
    // Reinstall repairs the missing executable; explicit teardown removes ownership.
    await call([process.execPath, 'add', '-g', '--trust', archive]);
    await call([bin, 'setup']);
    // A hook failure must stop removal, not pretend cleanup succeeded.
    const validUnit = await readFile(unit);
    await writeFile(unit, 'modified by another owner');
    await call([process.execPath, 'run', 'preuninstall'], 1, root);
    if (await readFile(unit, 'utf8') !== 'modified by another owner') throw new Error('Failed hook changed unowned service');
    await writeFile(unit, validUnit);
    await call([process.execPath, 'run', 'preuninstall'], 0, root);
    if (await Bun.file(unit).exists()) throw new Error('Teardown left user service');
    if (!(await readFile(config)).equals(saved)) throw new Error('Teardown changed preferences');
    await call([process.execPath, 'remove', '-g', '@tyvsmith/steam-native-notifications']);
    if (await Bun.file(join(root, 'package.json')).exists()) throw new Error('Bun removal left application files');
    console.log('Packaged Bun CLI passed: trusted global install, headless hook, asset inventory, arbitrary cwd/spaces, global versus local hooks, daemon PID/build readiness, reinstall, simulated next-release upgrade/downgrade, setup/teardown hooks, guarded local and unowned hooks, propagated cleanup failure, removal without automatic hooks and recovery');
} finally { try { process.kill(Number(await readFile(join(home, 'daemon.pid'), 'utf8')), 'SIGTERM'); } catch {} await rm(home, { recursive: true, force: true }); }
