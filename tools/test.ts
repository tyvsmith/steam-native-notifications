/** Keep platform dependencies and module-mock isolation explicit. */
const bun = process.execPath;
const shared = [
    [bun, 'tools/test-routes'],
    [bun, 'tools/test-frontend'],
    [bun, 'test', 'tools/load-frontend.test.ts', 'tools/diagnostics.test.ts', 'tools/cli-options.test.ts',
        'tools/millennium-control.test.ts', 'tools/millennium-diagnostics.test.ts', 'tools/click-dispatch.test.ts',
        'tools/devtools.test.ts', 'tools/windows-host-focus.test.ts', 'tools/mep.test.ts', 'tools/snn.test.ts',
        'tools/toastdb.test.ts', 'tools/capture.test.ts'],
    [bun, 'test', 'shared/diagnostics.test.ts', 'shared/contracts.test.ts', 'shared/settings-policy.test.ts',
        'shared/settings-actions.test.ts', 'shared/command-result.test.ts'],
    // These suites install module mocks; retain their separate processes.
    ...['settings-panel', 'presentation', 'platform'].map(name => [bun, 'test', `tools/${name}.test.ts`]),
];
const linux = [
    ['lua5.4', 'tools/test-backend'],
    [bun, 'test', 'tools/wayland-focus-protocol.test.ts'],
    ...['game-focus', 'gamescope-focus', 'windows-focus-adapter'].map(name => ['luajit', `tools/${name}.test.lua`]),
];
const windows = [
    ['powershell.exe', '-NoProfile', '-File', 'tools/test-windows-notify-lifecycle.ps1'],
    ['powershell.exe', '-NoProfile', '-File', 'tools/test-windows-notify-action.ps1', '-Offline'],
    ['powershell.exe', '-NoProfile', '-File', 'tools/test-game-focus.ps1'],
];
const group = process.argv[2] ?? 'all';
if (process.argv.length > 3 || !['all', 'shared', 'linux', 'windows'].includes(group)) {
    throw new Error('Usage: bun tools/test.ts [all|shared|linux|windows]');
}
if ((group === 'linux' && process.platform !== 'linux') || (group === 'windows' && process.platform !== 'win32')) {
    throw new Error(`${group} checks require their native platform`);
}
const native = process.platform === 'linux' ? linux : process.platform === 'win32' ? windows : null;
if (group === 'all' && !native) throw new Error('Use shared checks on unsupported platforms');
const commands = group === 'shared' ? shared : group === 'linux' ? linux : group === 'windows' ? windows : [...shared, ...native!];
for (const command of commands) {
    console.log(`\n> ${command.slice(1).join(' ')}`);
    const child = Bun.spawn(command, { cwd: import.meta.dir + '/..', stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
    const code = await child.exited;
    if (code !== 0) process.exit(code || 1);
}
export {};
