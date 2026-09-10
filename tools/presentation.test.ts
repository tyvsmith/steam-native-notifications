import { beforeEach, expect, mock, test } from 'bun:test';

// Exercise the real popup lifecycle and settings panel with only host APIs replaced.
const store: Record<string, unknown> = {};
let updateSetting: (key: string, value: unknown) => void;
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

mock.module('react/jsx-runtime', () => ({ jsx: element, jsxs: element, Fragment: 'fragment' }));
mock.module('react', () => ({
	useState: () => [platformState, (value: unknown) => { platformState = value; }],
	useEffect: (callback: () => void) => { effect = callback; },
}));
mock.module('millennium', () => ({
	definePlugin: (fn: any) => fn,
	IconsModule: {},
	DialogControlsSection: 'section',
	DialogControlsSectionHeader: 'header',
	DialogBodyText: 'text',
	ToggleField: 'toggle',
	usePluginConfig: (key: string) => [store[key], async (value: unknown) => set(key, value)],
	pluginConfig: { getAll: async () => ({ ...store }) },
	subscribePluginConfig: (callback: typeof updateSetting) => { updateSetting = callback; },
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

const { DEFAULTS, settings, loadSettings } = await import('../frontend/settings');
const { presentationFor } = await import('../frontend/presentation');
const { SettingsPanel } = await import('../frontend/SettingsPanel');
const { default: plugin } = await import('../frontend/index');
plugin();
await loadSettings();

function set(key: string, value: unknown) { store[key] = value; updateSetting(key, value); }
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
function toast(surface: 'desktop' | 'game' | 'unknown' = 'desktop') {
	let closed = 0;
	const name = surface === 'desktop' ? `notificationtoasts_${++sequence}_desktop`
		: surface === 'game' ? `notificationtoasts_uid570-${++sequence}` : `notificationtoasts_unknown-${++sequence}`;
	const win = { name, closed: false, close() { closed++; }, document: {
		body: { innerText: 'Download complete\nAircar' }, images: [] as unknown[], querySelectorAll: (): unknown[] => [],
	} };
	onPopup({ window: win });
	return { closed: () => closed, name, win };
}
function nodes(node: any): any[] {
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
	expect(desktop.closed()).toBe(1);
	expect(game.closed()).toBe(0);
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
			expect(popup.closed()).toBe(steam ? 0 : 1);
			if (os) expect(notifications[0][5]).toBe(String(history));
			else expect(logs.some((line) => line.startsWith('replay: candidates'))).toBe(false);
		});
	}
}

test('unknown capture surface leaves Steam alone and sends no OS copy', async () => {
	const popup = toast('unknown');
	await flush();
	expect(notifications).toHaveLength(0);
	expect(popup.closed()).toBe(0);
});

for (const failure of ['unsupported', 'reject', 'throw']) {
	test(`native ${failure} preserves a replacement Steam toast`, async () => {
		notifyReply = failure === 'throw' ? () => { throw Error('unavailable'); }
			: failure === 'reject' ? async () => { throw Error('unavailable'); } : async () => failure;
		let popup: ReturnType<typeof toast>;
		expect(() => { popup = toast(); }).not.toThrow();
		await flush();
		expect(popup!.closed()).toBe(0);
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
	expect(popup.closed()).toBe(1);
});

test('the same popup delivers only once', async () => {
	const popup = toast();
	onPopup({ window: popup.win });
	await flush();
	expect(notifications).toHaveLength(1);
});

test('panel groups desktop before game and shows all six Windows controls', () => {
	const sections = nodes(SettingsPanel()).filter((node) => node.type === 'header');
	expect(sections.map((node) => node.props.children)).toEqual(['Outside games', 'Inside games']);
	expect(toggles().map((node) => [node.props.label, node.props.checked])).toEqual([
		['Show OS notifications', true], ['Show Steam notifications', false], ['Save to Notification Center only', false],
		['Show OS notifications', true], ['Show Steam notifications', true], ['Save to Notification Center only', false],
	]);
});

test('disabling OS hides only its history control without clearing its preference', () => {
	set('notificationCenterOnlyOutsideGame', true);
	toggles()[0].props.onChange(false);
	expect(toggles()).toHaveLength(5);
	expect(store.notificationCenterOnlyOutsideGame).toBe(true);
	toggles()[0].props.onChange(true);
	expect(toggles()[2].props.checked).toBe(true);
});

for (const platform of ['linux', 'macos', 'unknown']) {
	test(`${platform} hides both Windows controls`, () => {
		platformState = platform;
		expect(toggles()).toHaveLength(4);
	});
}

test('panel resolves backend platform after mounting', async () => {
	platformState = 'unknown';
	SettingsPanel();
	effect?.();
	await flush();
	expect(toggles()).toHaveLength(6);
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
		expect(toggles()[1].props.checked).toBe(false);
	}
});

test('both-off notice applies only to the disabled context', () => {
	set('notifyOutsideGame', false);
	const notices = nodes(SettingsPanel()).filter((node) => node.props?.children === 'Notifications are off for this context');
	expect(notices).toHaveLength(1);
	expect(toggles().slice(-3).map((node) => node.props.checked)).toEqual([true, true, false]);
});

test('developer options have a header and stay hidden outside developer mode', () => {
	expect(nodes(SettingsPanel()).some((node) => node.props?.children === 'Developer options')).toBe(false);
	set('devMode', true);
	const headers = nodes(SettingsPanel()).filter((node) => node.type === 'header');
	expect(headers.map((node) => node.props.children)).toEqual(['Outside games', 'Inside games', 'Developer options']);
	expect(toggles().at(-1).props.label).toBe('Developer: accept test commands from tools/fire');
});
