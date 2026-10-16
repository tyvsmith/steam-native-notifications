import { expect, test } from 'bun:test';
import { discoverSettings, isDesktopSettings, insertPage } from './steam-settings';
test('only the desktop Steam settings page list qualifies; append once without mutating Steam', () => {
    const props = { page: '/settings/account', pages: [{ identifier: '/settings/account' }, { identifier: '/settings/notifications' }, { identifier: '/settings/interface' }] };
    expect(isDesktopSettings(props)).toBe(true);
    expect(isDesktopSettings({ ...props, page: '/overlay/settings/account' })).toBe(false);
    expect(isDesktopSettings({ ...props, pages: [] })).toBe(false);
    const page = { identifier: 'snn-native', title: 'Native Notifications' };
    const added = insertPage(props.pages, page);
    expect(added.slice(-2)).toEqual(['separator', page]);
    expect(added.length).toBe(5); expect(props.pages.length).toBe(3);
    expect(insertPage(added, page).length).toBe(5);
});
test('discovery refuses missing or ambiguous private interfaces without loading unrelated factories', () => {
    let loaded = 0;
    const requireModule: any = () => { loaded++; return {}; };
    requireModule.m = { unrelated() {} };
    expect(() => discoverSettings(requireModule)).toThrow();
    expect(loaded).toBe(0);
});

test('panel navigation stays local, forwards Steam selections and restores only its own hook', async () => {
    const { mountSettings, PAGE_ID } = await import('./steam-settings');
    let selected: string | null = null;
    const React: any = {
        createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }),
        forwardRef: (render: any) => ({ render }), Component: class {},
        useState: () => [selected, (value: string | null) => { selected = value; }], useEffect() {},
    };
    const original = (): null => null; const widget = { render: original as any }; const states: string[] = [];
    const stop = mountSettings(React, widget, (): null => null, state => states.push(state));
    const navigated: string[] = [];
    const props = { page: '/settings/account', pages: [{ identifier: '/settings/account' }, { identifier: '/settings/notifications' }, { identifier: '/settings/interface' }], onPageRequested: (id: string) => navigated.push(id) };
    const render = () => { const child = widget.render(props, null).props.children[0]; return child.type(child.props).props; };
    render().onPageRequested(PAGE_ID);
    expect(render().page).toBe(PAGE_ID); expect(navigated).toEqual([]);
    render().onPageRequested('/settings/notifications');
    expect(navigated).toEqual(['/settings/notifications']); expect(render().page).toBe('/settings/account');
    expect(widget.render({ pages: [], page: 'other' }, null).type.render).toBe(original);
    stop(); expect(widget.render).toBe(original); expect(states).toEqual(['installed', 'stopped']);
    const stopAgain = mountSettings(React, widget, (): null => null, () => {});
    const otherPatch = (): null => null; widget.render = otherPatch; stopAgain(); expect(widget.render).toBe(otherPatch);
});

test('an open Steam dialog prevents patching an already mounted component', async () => {
    const { mountSettings } = await import('./steam-settings');
    const render = () => 'original'; const widget = { render }; const instances = new Set([{}]);
    expect(() => mountSettings({} as any, widget, () => 'panel', () => {}, instances)).toThrow('Close Steam dialogs');
    expect(widget.render).toBe(render);
});

test('registry discovery accepts Steam observable sets and refuses malformed collections', async () => {
    const { isSettingsRegistry } = await import('./steam-settings');
    const observable = { size: 1, [Symbol.toStringTag]: 'Set', values() { return [][Symbol.iterator](); }, has() { return false; } };
    expect(isSettingsRegistry(observable)).toBe(true);
    expect(isSettingsRegistry(new Set())).toBe(true);
    expect(isSettingsRegistry({ size: -1 })).toBe(false);
});
