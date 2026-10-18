import { expect, test } from 'bun:test';
import { discoverSettings, isDesktopSettings, appendSection, mountSettings } from './steam-settings';
const React: any = {
    createElement: (type: any, props: any, ...children: any[]) => ({ type, key: props?.key ?? null, ref: props?.ref ?? null, props: { ...props, ...(children.length ? { children } : {}) } }),
    cloneElement: (element: any, props: any, ...children: any[]) => ({ ...element, props: { ...element.props, ...props, ...(children.length ? { children } : {}) } }),
    isValidElement: (value: any) => !!value?.type && !!value?.props,
    forwardRef: (render: any) => ({ render }),
    Component: class { props: any; constructor(props: any) { this.props = props; } },
};
const Body = (): null => null;
function fixture(Native = (props: any) => React.createElement(Body, { nativeOption: props.account }, 'native-controls')) {
    const native = React.createElement(Native, { account: 'current', key: 'native-page', ref: 'native-ref' });
    return { page: '/settings/notifications', pages: [
        { identifier: '/settings/account' }, 'separator',
        { identifier: '/settings/notifications', title: 'Notifications', icon: 'native-icon', content: native },
        { identifier: '/settings/interface' },
    ], onPageRequested: (_id: string) => {} };
}
test('append changes only the unique Notifications content and never sidebar entries', () => {
    const props = fixture(); const replacement = React.createElement(Body, {});
    expect(isDesktopSettings(props)).toBe(true);
    expect(isDesktopSettings({ ...props, page: '/overlay/settings/account' })).toBe(false);
    const pages = appendSection(React, props.pages, () => replacement);
    expect(pages).not.toBe(props.pages); expect(pages.length).toBe(props.pages.length);
    expect(pages[0]).toBe(props.pages[0]); expect(pages[1]).toBe('separator'); expect(pages[3]).toBe(props.pages[3]);
    expect(pages[2]).toEqual({ ...(props.pages[2] as object), content: replacement });
    expect(appendSection(React, pages, value => value)).toBe(pages);
});
test('missing, ambiguous or malformed Notifications descriptors remain untouched', () => {
    const pages = fixture().pages;
    for (const value of [pages.filter(p => (p as any).identifier !== '/settings/notifications'),
        [...pages, pages[2]], pages.map(p => (p as any).identifier === '/settings/notifications' ? { ...p as object, content: (): null => null } : p)]) {
        expect(appendSection(React, value, () => { throw Error('must not wrap'); })).toBe(value);
    }
});
test('discovery refuses missing or ambiguous private interfaces without loading unrelated factories', () => {
    let loaded = 0;
    const requireModule: any = () => { loaded++; return {}; };
    requireModule.m = { unrelated() {} };
    expect(() => discoverSettings(requireModule)).toThrow();
    expect(loaded).toBe(0);
});
test('native body props and children survive; only extension is inside its error boundary', () => {
    const original = (): null => null; const widget = { render: original as any }; const states: string[] = [];
    const Panel = (): null => null;
    const stop = mountSettings(React, widget, Body, Panel, state => states.push(state));
    const props = fixture(); const ref = {};
    const rendered = widget.render(props, ref);
    expect(rendered.type.render).toBe(original);
    expect(rendered.props.page).toBe(props.page);
    expect(rendered.props.onPageRequested).toBe(props.onPageRequested);
    expect(rendered.props.ref).toBe(ref);
    const content = rendered.props.pages[2].content;
    expect(content.key).toBe('native-page'); expect(content.ref).toBe('native-ref');
    const body = content.type(content.props);
    expect(body.type).toBe(Body); expect(body.props.nativeOption).toBe('current');
    const children = body.props.children;
    expect(children[0]).toEqual(['native-controls']);
    const boundary = new children[1].type(children[1].props);
    expect(boundary.render()[0].type).toBe(Panel);
    boundary.state = children[1].type.getDerivedStateFromError(); boundary.componentDidCatch();
    expect(boundary.render()).toBeNull(); expect(children[0]).toEqual(['native-controls']);
    expect(states).toContain('unavailable');
    expect(widget.render({ pages: [], page: 'other' }, ref).props.pages).toEqual([]);
    stop(); expect(widget.render).toBe(original);
    const stopAgain = mountSettings(React, widget, Body, Panel, () => {});
    const otherPatch = (): null => null; widget.render = otherPatch; stopAgain(); expect(widget.render).toBe(otherPatch);
});
test('wrapper is stable per native type, invokes once, and does not append twice', () => {
    let calls = 0; const Native = () => { calls++; return React.createElement(Body, {}, 'native'); };
    const widget: any = { render: (): any => null }; mountSettings(React, widget, Body, (): null => null, () => {});
    const props = fixture(Native);
    const first = widget.render(props).props.pages[2].content;
    const second = widget.render(props).props.pages[2].content;
    expect(first.type).toBe(second.type); expect(calls).toBe(0);
    first.type(first.props); expect(calls).toBe(1); second.type(second.props); expect(calls).toBe(2);
    const changed = widget.render(fixture()).props.pages[2].content;
    expect(changed.type).not.toBe(first.type);
    const pages = widget.render(props).props.pages;
    expect(widget.render({ ...props, pages }).props.pages).toBe(pages);
});
test('unsupported component shapes and changed body output are preserved without a second call', () => {
    const widget: any = { render: (): any => null }; mountSettings(React, widget, Body, (): null => null, () => {});
    for (const type of [React.Component, { render() {} }, { type: (): null => null }, async (): Promise<null> => null]) {
        const props = fixture(); (props.pages[2] as any).content.type = type;
        expect(widget.render(props).props.pages).toBe(props.pages);
    }
    let calls = 0; const other = React.createElement('div', {}, 'unchanged');
    const props = fixture(() => { calls++; return other; });
    const content = widget.render(props).props.pages[2].content;
    expect(content.type(content.props)).toBe(other); expect(calls).toBe(1);
});
test('an open Steam dialog prevents patching an already mounted component', () => {
    const render = () => 'original'; const widget = { render }; const instances = new Set([{}]);
    expect(() => mountSettings({} as any, widget, Body, () => 'panel', () => {}, instances)).toThrow('Close Steam dialogs');
    expect(widget.render).toBe(render);
});
test('registry discovery accepts Steam observable sets and refuses malformed collections', async () => {
    const { isSettingsRegistry } = await import('./steam-settings');
    const observable = { size: 1, [Symbol.toStringTag]: 'Set', values() { return [][Symbol.iterator](); }, has() { return false; } };
    expect(isSettingsRegistry(observable)).toBe(true);
    expect(isSettingsRegistry(new Set())).toBe(true);
    expect(isSettingsRegistry({ size: -1 })).toBe(false);
});
