import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MARKER, MARKER_ACTION, markerRepairer, restoreMarker } from './marker';

async function fixture(owner?: string) {
    const root = await mkdtemp(join(tmpdir(), 'snn-marker-'));
    const steam = join(root, 'Steam'), state = join(root, 'standalone-install.json');
    await Bun.write(join(steam, 'steam.sh'), '');
    if (owner !== undefined) await writeFile(state, JSON.stringify({ version: 3, steam: owner === 'self' ? steam : owner }));
    return { root, steam, state, marker: join(steam, MARKER) };
}

test('recreates a marker a Steam update deleted from the integrated root', async () => {
    const f = await fixture('self');
    try {
        expect(await restoreMarker(f.state, f.steam)).toBe('restored');
        expect(await readFile(f.marker, 'utf8')).toBe('');
        if (process.platform !== 'win32') expect((await stat(f.marker)).mode & 0o777).toBe(0o600);
        expect(await restoreMarker(f.state, f.steam)).toBe('present');
    } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('leaves Steam alone without an integration owning that root', async () => {
    for (const owner of [undefined, '/elsewhere/Steam']) {
        const f = await fixture(owner);
        try {
            expect(await restoreMarker(f.state, f.steam)).toBe('unowned');
            expect(await Bun.file(f.marker).exists()).toBe(false);
        } finally { await rm(f.root, { recursive: true, force: true }); }
    }
    const f = await fixture('self');
    try {
        await writeFile(f.state, '{not json');
        expect(await restoreMarker(f.state, f.steam)).toBe('unowned');
    } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('a missing marker with Steam still listening is repaired without restart advice', async () => {
    const f = await fixture('self');
    const actions: string[] = [], logs: string[] = [];
    const repair = markerRepairer({ statePath: f.state, steam: f.steam, log: line => { logs.push(line); }, advise: action => actions.push(action) });
    try {
        await repair(false);
        expect(await Bun.file(f.marker).exists()).toBe(true);
        expect(actions).toEqual([]);
        expect(logs.at(-1)).toContain('next Steam launch uses it');
        await rm(f.marker);
        await repair(true);
        expect(actions).toEqual([MARKER_ACTION]);
        expect(logs.at(-1)).toContain('Steam restart required');
    } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('repair failures are logged once and never thrown', async () => {
    const f = await fixture('self');
    const logs: string[] = [];
    await rm(f.steam, { recursive: true });
    const repair = markerRepairer({ statePath: f.state, steam: f.steam, log: line => { logs.push(line); }, advise: () => {} });
    try {
        await repair(true); await repair(true);
        expect(logs.filter(line => line.startsWith('standalone: marker: repair failed:'))).toHaveLength(1);
    } finally { await rm(f.root, { recursive: true, force: true }); }
});
