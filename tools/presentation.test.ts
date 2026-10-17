import { beforeEach, expect, mock, test } from 'bun:test';

// Exercise the real popup lifecycle and settings panel with only host APIs replaced.
const store: Record<string, unknown> = {};
let emitSettings = true;
const settingListeners = new Set<(key: string, value: unknown) => void>();
let onPopup: (popup: any) => void;
let sequence = 0;
let notifyReply: () => Promise<string> = async () => 'ok';
const notifications: string[][] = [];
const logs: string[] = [];
const element = (type: any, props: any) => ({ type, props });
let effect: (() => void) | undefined;
let platformState: unknown = 'unknown';
let resolvePlatform!: (value: string) => void;
const platformReply = new Promise<string>((resolve) => { resolvePlatform = resolve; });

mock.module('../frontend/millennium-diagnostics', () => ({ startMillenniumDiagnostics: () => () => {}, reportCommandResult: async () => {} }));
mock.module('react/jsx-runtime', () => ({ jsx: element, jsxs: element, Fragment: 'fragment' }));
mock.module('../shared/steam-settings-controls', () => ({ steamSettingsControls: () => ({ Theme: 'theme', Section: 'section', Toggle: 'toggle', Button: 'button', Description: 'text', ActionSection: 'native-actions' }) }));
mock.module('react', () => ({
    createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }),
	useState: (initial: unknown) => [typeof initial === 'object' ? settings() : initial === 'unknown' ? platformState : initial, (value: unknown) => { if (initial === 'unknown') platformState = value; }],
	useRef: (initial: unknown) => ({ current: initial }),
	useEffect: (callback: () => void) => { effect = callback; },
}));
mock.module('millennium', () => ({
	definePlugin: (fn: any) => fn,
	IconsModule: {},
	DialogControlsSection: 'section',
	DialogControlsSectionHeader: 'header',
	DialogBodyText: 'text',
	DialogButton: 'button',
	ToggleField: 'toggle',
	usePluginConfig: (key: string) => [store[key], async (value: unknown) => set(key, value)],
	pluginConfig: { getAll: async () => ({ ...store }), set: async (key: string, value: unknown) => set(key, value) },
	subscribePluginConfig: (callback: (key: string, value: unknown) => void) => { settingListeners.add(callback); return () => settingListeners.delete(callback); },
	findModuleExport: (): undefined => undefined,
	ffi: (name: string) => (...args: string[]) => {
		if (name === 'Notify') { notifications.push(args); return notifyReply(); }
		if (name === 'Log') logs.push(args[0]);
		return name === 'Platform' ? platformReply : Promise.resolve('{}');
	},
}));
Reflect.set(globalThis, 'window', { setInterval: () => 1, clearInterval() {} });
Reflect.set(globalThis, 'g_PopupManager', {
	AddPopupCreatedCallback(callback: typeof onPopup) { onPopup = callback; return { Unregister() {} }; },
	AddPopupDestroyedCallback() { return { Unregister() {} }; },
});

const { DEFAULTS, settings, loadSettings, settingsHost } = await import('../frontend/settings');
const { presentationFor } = await import('../frontend/presentation');
const { SettingsPanel } = await import('../frontend/SettingsPanel');
const { default: plugin } = await import('../frontend/index');
plugin();
await loadSettings();

function set(key: string, value: unknown) { store[key] = value; if (emitSettings) for (const listener of settingListeners) listener(key, value); }
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
function toast(surface: 'desktop' | 'game' | 'unknown' = 'desktop', onDismiss?: () => void) {
	let dismissed = 0; let rawClosed = 0;
	const name = surface === 'desktop' ? `notificationtoasts_${++sequence}_desktop`
		: surface === 'game' ? `notificationtoasts_uid570-${++sequence}` : `notificationtoasts_unknown-${++sequence}`;
	const win = { name, closed: false, close() { rawClosed++; }, document: {
		body: { innerText: 'Download complete\nAircar' }, images: [] as unknown[], querySelectorAll: (): unknown[] => [],
	} };
    const doc = win.document;
    const notification = { notificationID: String(sequence) };
    const bound = { memoizedProps: { notification, onDismiss: () => { onDismiss?.(); dismissed++; } },
        return: { tag: 4, stateNode: { containerInfo: { ownerDocument: doc } } } };
    doc.querySelectorAll = (): any[] => [{ __reactFiber$test: bound }];
    onPopup({ window: win });
    return { dismissed: () => dismissed, rawClosed: () => rawClosed, name, win };
}
function nodes(node: any): any[] {
	if (Array.isArray(node)) return node.flatMap(nodes);
	if (!node || typeof node !== 'object') return [];
	if (typeof node.type === 'function') return nodes(node.type(node.props));
	return [node, ...[node.props?.children].flat().flatMap(nodes)];
}
function toggles() { return nodes(SettingsPanel()).filter((node) => node.type === 'toggle'); }

beforeEach(() => {
	for (const [key, value] of Object.entries(DEFAULTS)) set(key, value);
	notifications.length = 0;
	logs.length = 0;
	notifyReply = async () => 'ok';
	platformState = 'windows';
});

test('stash Steam handler before waiting for platform discovery', async () => {
	set('notificationCenterOnlyOutsideGame', true);
	const doc: any = { body: { innerText: 'Test notification' }, images: [] };
	const fiber = { tag: 4, stateNode: { containerInfo: { ownerDocument: doc } }, memoizedProps: { onClick() {} } };
	doc.querySelectorAll = () => [{ __reactFiber$test: fiber }];
	onPopup({ window: { name: `notificationtoasts_${++sequence}_desktop`, document: doc, close() {} } });
	await flush();
	const stashedBeforeProbe = logs.some((line) => line.includes('stashed=onClick'));
	// Steam can destroy the popup while the backend query is pending.
	doc.querySelectorAll = (): unknown[] => [];
	resolvePlatform('"windows"');
	await flush();
	expect(stashedBeforeProbe).toBe(true);
	expect(notifications).toHaveLength(1);
});

test('fresh defaults replace desktop Steam toasts and preserve game Steam toasts', async () => {
	expect(settings()).toMatchObject({ notifyOutsideGame: true, notifyInGame: true,
		showSteamOutsideGame: false, showSteamInGame: true,
		notificationCenterOnlyOutsideGame: false, notificationCenterOnlyInGame: false,
		devMode: false, devFire: false });
	const desktop = toast();
	const game = toast('game');
	await flush();
	expect(desktop.dismissed()).toBe(1);
    expect(desktop.rawClosed()).toBe(0);
	expect(game.dismissed()).toBe(0);
	expect(notifications).toHaveLength(2);
});

for (const surface of ['desktop', 'game'] as const) {
	for (const os of [false, true]) for (const steam of [false, true]) for (const history of [false, true]) {
		test(`${surface}: OS=${os} Steam=${steam} history=${history}`, async () => {
			const suffix = surface === 'desktop' ? 'OutsideGame' : 'InGame';
			set(`notify${suffix}`, os);
			set(`showSteam${suffix}`, steam);
			set(`notificationCenterOnly${suffix}`, history);
			const popup = toast(surface);
			await flush();
			expect(notifications).toHaveLength(os ? 1 : 0);
			expect(popup.dismissed()).toBe(steam ? 0 : 1);
			if (os) expect(notifications[0][5]).toBe(String(history));
			else expect(logs.some((line) => line.startsWith('replay: candidates'))).toBe(false);
		});
	}
}

test('unknown capture surface leaves Steam alone and sends no OS copy', async () => {
	const popup = toast('unknown');
	await flush();
	expect(notifications).toHaveLength(0);
	expect(popup.dismissed()).toBe(0);
});

for (const failure of ['unsupported', 'reject', 'throw']) {
	test(`native ${failure} preserves a replacement Steam toast`, async () => {
		notifyReply = failure === 'throw' ? () => { throw Error('unavailable'); }
			: failure === 'reject' ? async () => { throw Error('unavailable'); } : async () => failure;
		let popup: ReturnType<typeof toast>;
		expect(() => { popup = toast(); }).not.toThrow();
		await flush();
		expect(popup!.dismissed()).toBe(0);
	});
}

test('capture freezes settings while delivery acknowledgement is pending', async () => {
	let acknowledge!: (value: string) => void;
	notifyReply = () => new Promise((resolve) => { acknowledge = resolve; });
	const popup = toast();
	await flush();
	set('showSteamOutsideGame', true);
	acknowledge('"ok"');
	await flush();
	expect(popup.dismissed()).toBe(1);
});

test('the same popup delivers only once', async () => {
	const popup = toast();
	onPopup({ window: popup.win });
	await flush();
	expect(notifications).toHaveLength(1);
});

test('panel exposes one section with five ordered controls and Windows additions', () => {
	const sections = nodes(SettingsPanel()).filter((node) => node.type === 'section');
	expect(sections.map((node) => node.props.label)).toEqual(['Operating system notifications']);
	expect(toggles().map((node) => [node.props.label, node.props.checked])).toEqual([
        ['Enable native notification integration', true],
        ['Show OS notifications while in a game', true], ['Show Steam notifications while in a game', true],
        ['Show OS notifications outside a game', true], ['Show Steam notifications outside a game', false],
        ['Save to Notification Center only while in a game', false], ['Save to Notification Center only outside a game', false],
	]);
});

test('disabling OS hides only its history control without clearing its preference', async () => {
	set('notificationCenterOnlyOutsideGame', true);
	toggles()[3].props.onChange(false);
	await flush();
	expect(toggles()).toHaveLength(6);
	expect(store.notificationCenterOnlyOutsideGame).toBe(true);
	toggles()[3].props.onChange(true);
	await flush();
	expect(toggles().at(-1).props.checked).toBe(true);
});

for (const platform of ['linux', 'macos', 'unknown']) {
	test(`${platform} hides both Windows controls`, () => {
		platformState = platform;
		expect(toggles()).toHaveLength(5);
	});
}

test('panel resolves backend platform after mounting', async () => {
	platformState = 'unknown';
	SettingsPanel();
	effect?.();
	await flush();
	expect(toggles()).toHaveLength(7);
});

test('non-Windows delivery ignores saved Notification Center preferences', () => {
	const preferences = { ...DEFAULTS, notificationCenterOnlyOutsideGame: true, notificationCenterOnlyInGame: true };
	for (const platform of ['linux', 'macos', 'unknown'] as const) {
		for (const appid of [0, 570]) expect(presentationFor(preferences, appid, platform).suppressPopup).toBe(false);
	}
});

test('settings ignore unknown keys and invalid stored values', async () => {
	set('showSteamInGame', 'false');
	set('hideSteamToast', true);
	set('constructor', true);
	await loadSettings();
	expect(settings().showSteamInGame).toBe(true);
	expect(Object.hasOwn(settings(), 'hideSteamToast')).toBe(false);
	expect(Object.hasOwn(settings(), 'constructor')).toBe(false);
});

test('deleted or invalid settings return delivery and panel to the same default', () => {
	for (const value of [null, undefined, 'false']) {
		set('showSteamOutsideGame', true);
		set('showSteamOutsideGame', value);
		expect(settings().showSteamOutsideGame).toBe(false);
		expect(toggles()[4].props.checked).toBe(false);
	}
});

test('shared developer control stays hidden outside developer mode', () => {
    expect(toggles().some(node => node.props.label === 'Developer: accept test commands')).toBe(false);
    set('devMode', true);
    expect(toggles().at(-1).props.label).toBe('Developer: accept test commands');
});

for (const surface of ['desktop', 'game', 'unknown'] as const) {
    for (const os of [false, true]) for (const steam of [false, true]) {
        test(`master off preserves ${surface} Steam toast with saved OS=${os} Steam=${steam}`, async () => {
            set('notifyOutsideGame', os); set('notifyInGame', os);
            set('showSteamOutsideGame', steam); set('showSteamInGame', steam);
            const before = { ...settings() };
            set('integrationEnabled', false);
            const popup = toast(surface); await flush();
            expect(notifications).toHaveLength(0); expect(popup.dismissed()).toBe(0);
            expect(settings()).toEqual({ ...before, integrationEnabled: false });
            set('integrationEnabled', true);
            expect(settings()).toEqual(before);
            const resumed = toast(surface); await flush();
            expect(notifications).toHaveLength(os && surface !== 'unknown' ? 1 : 0);
            expect(resumed.dismissed()).toBe(steam || surface === 'unknown' ? 0 : 1);
        });
    }
}
test('master bypasses every platform and capture surface including Windows history', () => {
    for (const platform of ['linux', 'windows', 'macos', 'unknown'] as const)
        for (const capture of [0, 570, null])
            for (const os of [false, true]) for (const steam of [false, true])
                expect(presentationFor({ ...DEFAULTS, integrationEnabled: false,
                    notifyInGame: os, notifyOutsideGame: os, showSteamInGame: steam, showSteamOutsideGame: steam,
                    notificationCenterOnlyInGame: true, notificationCenterOnlyOutsideGame: true,
                }, capture, platform)).toEqual({ sendNative: false, showSteam: true, suppressPopup: false });
});

test('missing native dismissal fails open instead of closing a CEF window', async () => {
    let closed = 0;
    onPopup({ window: { name: `notificationtoasts_${++sequence}_desktop`, close() { closed++; },
        document: { body: { innerText: 'Download complete\nAircar' }, images: [] as unknown[], querySelectorAll: (): unknown[] => [] } } });
    await flush();
    expect(notifications).toHaveLength(1); expect(closed).toBe(0);
    expect(logs.some(line => line.includes('native dismissal unavailable'))).toBe(true);
});

test('dismissal discovery requires a matching portal and unambiguous bound notification', async () => {
    const { toastDismissal } = await import('../frontend/dismiss');
    const doc: any = {};
    const notification = { notificationID: 42 };
    const fn = () => {};
    const portal: any = { tag: 4, stateNode: { containerInfo: { ownerDocument: doc } }, return: null };
    const bound: any = { memoizedProps: { notification, onDismiss: fn }, return: portal };
    doc.querySelectorAll = () => [{ __reactFiber$test: bound }];
    const win = { name: 'notificationtoasts_42_desktop', document: doc } as Window;
    expect(toastDismissal(win)).toBe(fn);
    bound.return = { memoizedProps: { notification, onDismiss: fn }, return: portal };
    expect(toastDismissal(win)).toBe(fn);
    bound.return.memoizedProps.onDismiss = () => {};
    expect(toastDismissal(win)).toBeNull();
    bound.return = portal; bound.memoizedProps.notification = { notificationID: 43 };
    expect(toastDismissal(win)).toBeNull();
    bound.memoizedProps.notification = notification;
    portal.stateNode.containerInfo.ownerDocument = {};
    expect(toastDismissal(win)).toBeNull();
    portal.stateNode.containerInfo.ownerDocument = doc;
    bound.return = null;
    expect(toastDismissal(win)).toBeNull();
    bound.return = portal;
    Object.defineProperty(bound, 'memoizedProps', { get() { throw Error('unmounted'); } });
    expect(toastDismissal(win)).toBeNull();
});

for (const verbose of [false, true]) {
    test(`throwing native dismissal retains safe failure and gates details (verbose=${verbose})`, async () => {
        set('verboseDiagnostics', verbose);
        const popup = toast('desktop', () => { throw Error('native lifecycle unavailable'); });
        await flush();
        expect(notifications).toHaveLength(1);
        expect(popup.rawClosed()).toBe(0); expect(popup.dismissed()).toBe(0);
        const failures = logs.filter(line => line.includes('could not dismiss'));
        expect(failures).toHaveLength(1);
        expect(failures[0].includes('native lifecycle unavailable')).toBe(verbose);
        if (!verbose) expect(failures[0]).toContain('enable verboseDiagnostics for details');
    });
}

test('delivery acknowledgement uses the callback captured before the tree changes', async () => {
    let acknowledge!: (reply: string) => void;
    notifyReply = () => new Promise(resolve => { acknowledge = resolve; });
    const popup = toast(); await flush();
    popup.win.document.querySelectorAll = (): unknown[] => [];
    acknowledge('ok'); await flush();
    expect(popup.dismissed()).toBe(1); expect(popup.rawClosed()).toBe(0);
});


test('panel saves control real delivery without Millennium subscription pushes', async () => {
    emitSettings = false;
    try {
        for (const os of [true, false]) for (const steam of [true, false]) {
            expect((await settingsHost.write({ notifyOutsideGame: os, showSteamOutsideGame: steam })).ok).toBe(true);
            notifications.length = 0;
            const popup = toast(); await flush();
            expect(notifications).toHaveLength(os ? 1 : 0);
            expect(popup.dismissed()).toBe(steam ? 0 : 1);
        }
        await settingsHost.write({ integrationEnabled: false });
        notifications.length = 0;
        const popup = toast(); await flush();
        expect(notifications).toHaveLength(0); expect(popup.dismissed()).toBe(0);
    } finally { emitSettings = true; }
});
