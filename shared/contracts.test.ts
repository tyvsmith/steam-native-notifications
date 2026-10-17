import { expect, test } from 'bun:test';
import { createRuntimeHost, createSettingsHost, parseCallableJson, BUILD_IDENTITY, type FfiFactory } from './host';
import { DEFAULTS, SETTINGS_SCHEMA, normalizeSettings, settingSupported, validateSettingsPatch } from './settings';
import * as standalone from '../standalone/adapter';

test('schema preserves nine defaults, platform availability and strict write validation', () => {
    expect(Object.keys(SETTINGS_SCHEMA)).toHaveLength(9);
    expect(DEFAULTS).toEqual({ integrationEnabled: true, notifyOutsideGame: true, notifyInGame: true, showSteamOutsideGame: false, showSteamInGame: true, notificationCenterOnlyOutsideGame: false, notificationCenterOnlyInGame: false, devMode: false, devFire: false });
    expect(normalizeSettings({ notifyInGame: false, devFire: 'true', old: true })).toEqual({ ...DEFAULTS, notifyInGame: false });
    for (const value of ([null, [], { devFire: 'true' }, { old: true }] as unknown[])) expect(() => validateSettingsPatch(value)).toThrow();
    expect(settingSupported('notificationCenterOnlyInGame', 'linux')).toBe(false);
    expect(settingSupported('notificationCenterOnlyInGame', 'windows')).toBe(true);
});

for (const kind of ['millennium', 'standalone'] as const) {
    test(`${kind} runtime adapter preserves positional arguments and serialized return shapes`, async () => {
        const calls: any[] = [];
        const responses = ['linux', '"linux"', '{"steamid64":"76561198000000001"}', '"{\\"steamid64\\":\\"76561198000000001\\"}"'];
        let factory: FfiFactory;
        if (kind === 'standalone') {
            (globalThis as any).__snnHost = (payload: string) => { const call = JSON.parse(payload); calls.push(call); (globalThis as any).__snnReply(call.id, responses.shift()); };
            factory = standalone.ffi;
        } else factory = (() => async (...args: unknown[]) => { calls.push({ args }); return responses.shift(); }) as FfiFactory;
        const host = createRuntimeHost(factory);
        expect(await host.call('Platform')).toBe('linux');
        expect(await host.call('Platform')).toBe('"linux"');
        for (let i = 0; i < 2; i++) expect(parseCallableJson(await host.call('Identity'), {})).toEqual({ steamid64: '76561198000000001' });
        await host.call('Notify', 'title', 'body', 'image', 'route', '17', 'false');
        expect(calls.at(-1).args).toEqual(['title', 'body', 'image', 'route', '17', 'false']);
    });
    test(`${kind} settings adapter normalizes defaults, overrides, removal and write support`, async () => {
        let stored: Record<string, unknown> = {};
        const listeners = new Set<(key: string, value: unknown) => void>();
        const host = createSettingsHost({ getAll: async () => stored,
            set: kind === 'millennium' ? async (key, value) => { stored[key] = value; for (const listener of listeners) listener(key, value); } : undefined,
            subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        });
        expect(await host.read()).toEqual(DEFAULTS);
        stored = { notifyOutsideGame: false, devFire: 'true' };
        expect(await host.read()).toEqual({ ...DEFAULTS, notifyOutsideGame: false });
        const changes: unknown[] = []; const stop = host.subscribe((key, value) => changes.push([key, value]));
        const result = await host.write({ devFire: true });
        expect(result.ok).toBe(kind === 'millennium');
        if ('code' in result) expect(result.code).toBe('unsupported');
        else expect(changes).toEqual([['devFire', true]]);
        stop(); expect(listeners.size).toBe(0);
        stored = {}; expect(await host.read()).toEqual(DEFAULTS);
        expect((await host.write({ devFire: 'bad' } as any)).ok).toBe(false);
    });
}
test('build identity and malformed serialized values fail safely', () => {
    expect(BUILD_IDENTITY.protocolVersion).toBe(1);
    expect(BUILD_IDENTITY.buildId).toMatch(/^[a-f0-9]{64}$/);
    for (const raw of ['broken', '"bad"', undefined, null]) expect(parseCallableJson(raw, {})).toEqual({});
});
