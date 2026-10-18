import { expect, test } from 'bun:test';
import { inspectEndpoint, windowsInspectionDependencies } from './diagnostics';

const root = 'C:\\Program Files (x86)\\Steam';
const owner = { address: '127.0.0.1', pid: 123, executable: root + '\\bin\\cef\\steamwebhelper.exe', sid: 'S-1-5-21-123', session: 2 };
const target = { type: 'page', title: 'SharedJSContext', url: 'https://steamloopback.host/sharedjscontext.html', webSocketDebuggerUrl: 'ws://127.0.0.1:8080/devtools/page/1' };
async function inspect(rows: unknown[], change?: (snapshot: any) => void) {
    const snapshot = { sid: owner.sid, session: owner.session, listeners: rows };
    change?.(snapshot);
    const dependencies = windowsInspectionDependencies(root, async () => JSON.stringify(snapshot));
    let fetched = false;
    dependencies.fetch = (async () => { fetched = true; return Response.json([target]); }) as unknown as typeof fetch;
    return { result: await inspectEndpoint(8080, dependencies), fetched };
}

test('Windows accepts only Steam in the current user session on loopback', async () => {
    expect((await inspect([owner])).result.kind).toBe('steam');
    expect((await inspect([{ ...owner, address: '::1', executable: owner.executable.toUpperCase() }])).result.kind).toBe('steam');
    expect((await inspect([])).result.kind).toBe('missing');
});

test('Windows rejects wildcard listeners before fetching CDP', async () => {
    for (const address of ['0.0.0.0', '::', '192.168.1.10']) {
        const { result, fetched } = await inspect([owner, { ...owner, address }]);
        expect(result.kind).toBe('unsafe'); expect(fetched).toBe(false);
    }
});

test('Windows refuses other users, sessions, executable names and sibling Steam paths', async () => {
    for (const patch of [
        { sid: 'S-1-5-21-456' }, { session: 3 }, { executable: null },
        { executable: root + '\\bin\\chrome.exe' },
        { executable: root + '-other\\steamwebhelper.exe' },
        { executable: root + '\\..\\steamwebhelper.exe' },
        { executable: 'D:\\Steam\\steamwebhelper.exe' },
    ]) {
        const { result, fetched } = await inspect([{ ...owner, ...patch }]);
        expect(result.kind).toBe('conflict'); expect(fetched).toBe(false);
    }
});

test('Windows fails closed on missing process metadata and failed inspection', async () => {
    expect((await inspect([{ ...owner, pid: null }])).result.kind).toBe('unsafe');
    expect((await inspect([owner], snapshot => { snapshot.session = 0; })).result.kind).toBe('unsafe');
    const denied = windowsInspectionDependencies(root, async () => { throw new Error('access denied'); });
    expect((await inspectEndpoint(8080, denied)).kind).toBe('unsafe');
    const invalid = windowsInspectionDependencies(root, async () => 'not JSON');
    expect((await inspectEndpoint(8080, invalid)).kind).toBe('unsafe');
});
