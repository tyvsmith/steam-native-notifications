import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';

// Keep replay, surface discovery, and dispatch real; replace only the host APIs.
const events: string[] = [];
let navigator: any;
let hostFocus = 'unknown';
const overlayStore = {
	OnGameOverlayActivateRequested(request: any) { events.push(`overlay:${request.appid}:${request.strDialog}`); },
	OnSteamURLOpenExternalForPID() {},
	GetNavigator() { return navigator; },
};
mock.module('millennium', () => ({
	ffi: (name: string) => async (value: string) => {
		if (name === 'FocusSteam') events.push(`focus:${value}`);
		if (name === 'GameHostFocus') return hostFocus;
		return '';
	},
	findModuleExport: (predicate: (value: unknown) => boolean) => predicate(overlayStore) ? overlayStore : undefined,
}));

const { dispatchClick } = await import('../frontend/clickbridge');
const { stashToastHandler, invokeReplayHandler } = await import('../frontend/replay');
const { trackOverlayFocus } = await import('../frontend/overlay');
const { clientOverlayAction } = await import('../frontend/routes');

let focusChanged: (appid: unknown) => void;
let sc: any;
let intervals: Map<number, () => void>;
let clock: ReturnType<typeof spyOn>;
let now: number;
let nextInterval = 0;
let nextToken = 0;

function mainWindow() {
	Reflect.set(globalThis, 'g_PopupManager', { m_mapPopups: new Map([['main', {
		window: { name: 'SP Desktop_uid0', SteamClient: { Window: { BringToFront() {} } } },
	}]]) });
}

function envelope(fallback: string | null = null, captureAppId = 0) {
	return { v: 1 as const, token: (++nextToken).toString(16).padStart(32, '0'), captureAppId, fallback, focus: 'main' as const };
}

function toastWindow(fn = () => { events.push('replay'); }): Window {
	const doc: any = {};
	const fiber = { tag: 4, stateNode: { containerInfo: { ownerDocument: doc } }, memoizedProps: { onClick: fn } };
	doc.querySelectorAll = () => [{ __reactFiber$test: fiber }];
	return { document: doc } as Window;
}

function capture(value: ReturnType<typeof envelope>, name = 'notificationtoasts_10000_desktop', fn = () => { events.push('replay'); }) {
	expect(stashToastHandler(toastWindow(fn), name, value.token)).toBe(true);
}

async function flush() {
	for (let i = 0; i < 20; i++) await Promise.resolve();
}

async function advance(ms: number) {
	now += ms;
	for (const callback of [...intervals.values()]) callback();
	await flush();
}

beforeEach(() => {
	events.length = 0;
	hostFocus = 'unknown';
	intervals = new Map();
	now = 100000;
	clock = spyOn(Date, 'now').mockImplementation(() => now);
	Reflect.set(globalThis, 'window', {
		setInterval(callback: () => void) { intervals.set(++nextInterval, callback); return nextInterval; },
		clearInterval(id: number) { intervals.delete(id); },
	});
	sc = {
		Overlay: { GetOverlayBrowserInfo: async () => [] },
		System: { UI: { RegisterForOverlayGameWindowFocusChanged(callback: typeof focusChanged) { focusChanged = callback; } } },
		URL: { ExecuteSteamURL(route: string) { events.push(`url:${route}`); } },
	};
	Reflect.set(globalThis, 'SteamClient', sc);
	trackOverlayFocus();
	focusChanged(0);
	navigator = { Media: { Grid() { events.push('media'); } } };
	overlayStore.OnGameOverlayActivateRequested = (request: any) => { events.push(`overlay:${request.appid}:${request.strDialog}`); };
	mainWindow();
});

afterEach(() => { clock.mockRestore(); });

test('desktop chat replay does not open the main window from tray', async () => {
	Reflect.set(globalThis, 'g_PopupManager', { m_mapPopups: new Map() });
	const click = { ...envelope(), focus: 'chat' as const };
	capture(click);
	void dispatchClick(click);
	await flush();
	expect(events).toEqual(['replay', 'focus:chat']);
});

for (const running of [false, true]) {
	test(`desktop chat fallback does not open main window (game running=${running})`, async () => {
		Reflect.set(globalThis, 'g_PopupManager', { m_mapPopups: new Map() });
		sc.Overlay.GetOverlayBrowserInfo = async () => running ? [{ appID: 570 }] : [];
		const click = { ...envelope('steam://friends/message/76561197982882208'), focus: 'chat' as const };
		void dispatchClick(click);
		await flush();
		expect(events).toEqual(['overlay:0:chat', 'focus:chat']);
	});
}

test('a backgrounded Gamescope host overrides stale Steam focus before replay', async () => {
	sc.Overlay.GetOverlayBrowserInfo = async () => [{ appID: 570 }];
	focusChanged(570);
	hostFocus = 'desktop';
	const click = envelope('steam://friends/message/76561198018634384', 570);
	capture(click, 'notificationtoasts_uid570-10000');
	await dispatchClick(click);
	expect(events).toEqual(['overlay:0:chat', 'focus:main']);
});

test('a focused Gamescope host preserves overlay replay', async () => {
	sc.Overlay.GetOverlayBrowserInfo = async () => [{ appID: 570 }];
	focusChanged(570);
	hostFocus = 'game';
	const click = envelope(null, 570);
	capture(click, 'notificationtoasts_uid570-10000');
	await dispatchClick(click);
	expect(events).toEqual(['replay']);
});

for (const name of [
	'notificationtoasts_uidbogus-10001',
	'notificationtoasts_uid570-42_desktop',
	'notificationtoasts_vr',
]) {
	test(`an unconfirmed toast surface cannot be stashed or replayed: ${name}`, async () => {
		const click = envelope();
		expect(stashToastHandler(toastWindow(), name, click.token)).toBe(false);
		await dispatchClick(click);
		expect(invokeReplayHandler(click.token, 0)).toBe(false);
		expect(events).toEqual([]);
	});
}

test('a Millennium desktop toast can be stashed and replayed', async () => {
	const click = envelope();
	capture(click, 'notificationtoasts_undefined_desktop');
	await dispatchClick(click);
	expect(events).toEqual(['replay', 'focus:main']);
});

for (const value of [null, undefined, false, true, '', ' ', 'bogus', '0', '570', -1, 0.5, NaN, Infinity, 4294967296, Number.MAX_SAFE_INTEGER + 1]) {
	test(`an invalid raw focus callback refuses dispatch: ${String(value)}`, async () => {
		const click = envelope('steam://openurl/https://steamcommunity.com/example');
		capture(click);
		sc.Overlay.GetOverlayBrowserInfo = async () => [{ appID: 570 }, { appID: 1 }];
		focusChanged(570);
		focusChanged(value);
		await dispatchClick(click);
		expect(events).toEqual([]);
	});
}

test('an invalid focus callback stays unknown even with an empty overlay list', async () => {
	const click = envelope();
	capture(click);
	focusChanged(null);
	await dispatchClick(click);
	expect(events).toEqual([]);
});

test('an out-of-range focus callback cannot select an out-of-range overlay', async () => {
	sc.Overlay.GetOverlayBrowserInfo = async () => [{ appID: 4294967296 }];
	focusChanged(4294967296);
	await dispatchClick(envelope('steam://openurl/https://steamcommunity.com/example'));
	expect(events).toEqual([]);
});

test('a valid zero focus callback restores desktop after an invalid callback', async () => {
	const click = envelope();
	capture(click);
	sc.Overlay.GetOverlayBrowserInfo = async () => [{ appID: 570 }];
	focusChanged(null);
	focusChanged(0);
	await dispatchClick(click);
	expect(events).toEqual(['replay', 'focus:main']);
});

test('a tampered envelope cannot move a desktop callback onto a game', async () => {
	const click = envelope('steam://openurl/https://steamcommunity.com/example');
	capture(click);
	sc.Overlay.GetOverlayBrowserInfo = async () => [{ appID: 570 }];
	focusChanged(570);
	await dispatchClick({ ...click, captureAppId: 570 });
	expect(events).toEqual(['overlay:570:https://steamcommunity.com/example']);
});

test('a matching game callback still replays', async () => {
	const click = envelope(null, 570);
	capture(click, 'notificationtoasts_uid570-10001');
	sc.Overlay.GetOverlayBrowserInfo = async () => [{ appID: 570 }];
	focusChanged(570);
	await dispatchClick(click);
	expect(events).toEqual(['replay']);
});

test('desktop replay raises its window first while a game runs in the background', async () => {
	const click = envelope();
	capture(click);
	sc.Overlay.GetOverlayBrowserInfo = async () => [{ appID: 570 }];
	Reflect.get(globalThis, 'g_PopupManager').m_mapPopups.get('main').window.SteamClient.Window.BringToFront = () => {
		events.push('raise');
		// Raising Steam can itself generate a focus event; selection is already made.
		focusChanged(570);
	};
	await dispatchClick(click);
	expect(events).toEqual(['raise', 'replay', 'focus:main']);
});

test('desktop replay waits for a window closed to the tray', async () => {
	const click = envelope();
	capture(click);
	Reflect.set(globalThis, 'g_PopupManager', { m_mapPopups: new Map() });
	const activation = dispatchClick(click);
	await flush();
	expect(events).toEqual(['url:steam://open/main']);
	mainWindow();
	await advance(250);
	await activation;
	expect(events).toEqual(['url:steam://open/main', 'replay', 'focus:main']);
});

test('desktop replay does not run when window creation times out', async () => {
	const click = envelope();
	capture(click);
	Reflect.set(globalThis, 'g_PopupManager', { m_mapPopups: new Map() });
	const activation = dispatchClick(click);
	await flush();
	await advance(6250);
	await activation;
	expect(events).toEqual(['url:steam://open/main']);
});

test('an absent replay without fallback does not open a window', async () => {
	Reflect.set(globalThis, 'g_PopupManager', { m_mapPopups: new Map() });
	await dispatchClick(envelope());
	expect(events).toEqual([]);
});

test('an overlay capture clicked with its game backgrounded uses desktop chat', async () => {
	const click = envelope('steam://friends/message/76561198000000000', 570);
	capture(click, 'notificationtoasts_uid570-10001');
	sc.Overlay.GetOverlayBrowserInfo = async () => [{ appID: 570 }];
	await dispatchClick(click);
	expect(events).toEqual(['overlay:0:chat', 'focus:main']);
});

test('a tampered envelope cannot move a game callback onto desktop', async () => {
	const click = envelope('steam://nav/games/details/570', 570);
	capture(click, 'notificationtoasts_uid570-10001');
	await dispatchClick({ ...click, captureAppId: 0 });
	expect(events).toEqual(['url:steam://nav/games/details/570', 'focus:main']);
});

test('the diagnostic name lookup also enforces the stored capture surface', () => {
	const click = envelope();
	capture(click, 'notificationtoasts_12345_desktop');
	expect(invokeReplayHandler('notificationtoasts_12345_desktop', 570)).toBe(false);
	expect(events).toEqual([]);
	expect(invokeReplayHandler('notificationtoasts_12345_desktop', 0)).toBe(true);
	expect(events).toEqual(['replay']);
});

test('unknown initial focus with a running game refuses dispatch', async () => {
	const click = envelope('steam://nav/games/details/570');
	capture(click);
	trackOverlayFocus();
	sc.Overlay.GetOverlayBrowserInfo = async () => [{ appID: 570 }];
	await dispatchClick(click);
	expect(events).toEqual([]);
});

test('an empty overlay list confirms desktop before the first focus event', async () => {
	const click = envelope();
	capture(click);
	trackOverlayFocus();
	await dispatchClick(click);
	expect(events).toEqual(['replay', 'focus:main']);
});

test('several running games use the positively focused overlay', async () => {
	sc.Overlay.GetOverlayBrowserInfo = async () => [{ appID: 730 }, { appID: 570 }];
	focusChanged(570);
	await dispatchClick(envelope('steam://openurl/https://steamcommunity.com/example'));
	expect(events).toEqual(['overlay:570:https://steamcommunity.com/example']);
});

test("Steam's hardware update fallback opens System settings in-game", async () => {
	sc.Overlay.GetOverlayBrowserInfo = async () => [{ appID: 570 }];
	focusChanged(570);
	await dispatchClick(envelope('steam://settings/controller'));
	expect(events).toEqual(['overlay:570:settings']);
});

test('an unverified settings route is refused in-game', async () => {
	sc.Overlay.GetOverlayBrowserInfo = async () => [{ appID: 570 }];
	focusChanged(570);
	await dispatchClick(envelope('steam://settings/account'));
	expect(events).toEqual([]);
});

test('the general fallback opens Steam while a game is focused', async () => {
	sc.Overlay.GetOverlayBrowserInfo = async () => [{ appID: 570 }];
	focusChanged(570);
	await dispatchClick(envelope('steam://open/main'));
	expect(events).toEqual(['url:steam://open/main', 'focus:main']);
});

test('the Millennium updates fallback opens on desktop while a game is focused', async () => {
	sc.Overlay.GetOverlayBrowserInfo = async () => [{ appID: 570 }];
	focusChanged(570);
	await dispatchClick(envelope('steam://millennium/settings/updates'));
	expect(events).toEqual(['url:steam://millennium/settings/updates', 'focus:main']);
});

test('an explicit Millennium activation opens on desktop while a game is focused', async () => {
	sc.Overlay.GetOverlayBrowserInfo = async () => [{ appID: 570 }];
	focusChanged(570);
	await dispatchClick(envelope('steam://millennium/sidebar'));
	expect(events).toEqual(['url:steam://millennium/sidebar', 'focus:main']);
});

for (const discovery of ['throws', 'missing', 'malformed', 'empty', 'other-game']) {
	test(`unknown surface refuses desktop replay and fallback when discovery is ${discovery}`, async () => {
		const click = envelope('steam://nav/games/details/570');
		capture(click);
		focusChanged(570);
		sc.Overlay.GetOverlayBrowserInfo = discovery === 'missing' ? undefined : async () => {
			if (discovery === 'throws') throw new Error('discovery failed');
			if (discovery === 'malformed') return {};
			return discovery === 'other-game' ? [{ appID: 730 }] : [];
		};
		await dispatchClick(click);
		expect(events).toEqual([]);
	});
}

test('failed discovery without a game signal still refuses desktop replay', async () => {
	const click = envelope();
	capture(click);
	sc.Overlay.GetOverlayBrowserInfo = async () => { throw new Error('discovery failed'); };
	await dispatchClick(click);
	expect(events).toEqual([]);
});

test('group chat has no durable action even with valid room coordinates', () => {
	expect(clientOverlayAction(9, { chat_group_id: '7', chat_id: '8' })).toBeNull();
});

test('group chat preserves same-session exact replay', async () => {
	const click = { ...envelope(), focus: 'chat' as const };
	capture(click);
	await dispatchClick(click);
	expect(events).toEqual(['replay', 'focus:chat']);
});

test('a group-chat notification without its session callback remains inert', async () => {
	await dispatchClick({ ...envelope(), focus: 'chat' });
	expect(events).toEqual([]);
});

test('a retained old group-chat fallback does not open a desktop window', async () => {
	Reflect.set(globalThis, 'g_PopupManager', { m_mapPopups: new Map() });
	const activation = dispatchClick(envelope('action:chatroom:7:8'));
	await flush();
	expect(events).toEqual([]);
	await activation;
});

test('desktop focus waits for delayed window creation and navigation', async () => {
	Reflect.set(globalThis, 'g_PopupManager', { m_mapPopups: new Map() });
	const activation = dispatchClick(envelope('steam://nav/games/details/570'));
	await flush();
	await advance(4500);
	expect(events).toEqual(['url:steam://open/main']);
	mainWindow();
	await advance(250);
	await activation;
	expect(events).toEqual(['url:steam://open/main', 'url:steam://nav/games/details/570', 'focus:main']);
});

test('a window creation timeout neither navigates nor focuses', async () => {
	Reflect.set(globalThis, 'g_PopupManager', { m_mapPopups: new Map() });
	const activation = dispatchClick(envelope('steam://nav/games/details/570'));
	await flush();
	await advance(6250);
	await activation;
	expect(events).toEqual(['url:steam://open/main']);
});

test('failed desktop action dispatch does not request focus', async () => {
	navigator = {};
	await dispatchClick(envelope('action:media'));
	expect(events).toEqual([]);
});

for (const route of ['action:media', 'action:screenshot:123', 'action:clip:456', 'action:requestplaytime', 'steam://friends/message/76561198000000000']) {
	function dispatchResult(fn: () => Promise<void>) {
		navigator = { Media: { Grid: fn, Screenshot: fn, Clip: fn }, RequestPlaytimeDialog: fn };
		overlayStore.OnGameOverlayActivateRequested = fn;
		// A running but unfocused game exercises the explicit desktop chat door.
		sc.Overlay.GetOverlayBrowserInfo = async () => [{ appID: 570 }];
	}
	test(`desktop focus waits for ${route} dispatch completion`, async () => {
		let finish: () => void;
		dispatchResult(() => new Promise<void>((resolve) => { finish = resolve; }));
		const activation = dispatchClick(envelope(route));
		await flush();
		expect(events).toEqual([]);
		finish!();
		await activation;
		expect(events).toEqual(['focus:main']);
	});
	test(`a rejected ${route} does not request focus`, async () => {
		dispatchResult(() => Promise.reject(new Error('dispatch failed')));
		await dispatchClick(envelope(route));
		expect(events).toEqual([]);
	});
}

for (const failure of ['throws', 'rejects', 'missing']) {
	test(`desktop URL dispatch that ${failure} does not request focus`, async () => {
		sc.URL.ExecuteSteamURL = failure === 'missing' ? undefined : () => {
			if (failure === 'throws') throw new Error('navigation failed');
			return Promise.reject(new Error('navigation failed'));
		};
		await dispatchClick(envelope('steam://nav/games/details/570'));
		expect(events).toEqual([]);
	});
}

test('desktop focus waits for URL dispatch completion', async () => {
	let finish: () => void;
	sc.URL.ExecuteSteamURL = () => new Promise<void>((resolve) => { finish = resolve; });
	const activation = dispatchClick(envelope('steam://nav/games/details/570'));
	await flush();
	expect(events).toEqual([]);
	finish!();
	await activation;
	expect(events).toEqual(['focus:main']);
});

test('a refused URL dispatch does not request focus', async () => {
	sc.URL.ExecuteSteamURL = () => false;
	await dispatchClick(envelope('steam://nav/games/details/570'));
	expect(events).toEqual([]);
});
