import { afterEach, expect, test } from 'bun:test';
import { chatFocusTarget } from '../frontend/chatfocus';
const sid = '76561197960265770'; // account 42
const originals = [Reflect.get(globalThis, 'g_FriendsUIApp'), Reflect.get(globalThis, 'g_PopupManager')];
afterEach(() => { Reflect.set(globalThis, 'g_FriendsUIApp', originals[0]); Reflect.set(globalThis, 'g_PopupManager', originals[1]); });
function setup() {
 const chat = {}, win = { closed: false, document: { title: 'a chat Ω', visibilityState: 'visible' } };
 const calls: unknown[][] = [];
 const container = { m_window: win, BIsClosed: () => false };
 Reflect.set(globalThis, 'g_FriendsUIApp', { m_ChatStore: { GetFriendChat(...args: unknown[]) { calls.push(args); return chat; } }, m_UIStore: { GetAppContainerForChat(value: unknown) { expect(value).toBe(chat); return container; } } });
 Reflect.set(globalThis, 'g_PopupManager', { m_mapPopups: new Map([['settings', { m_popup: { document: { title: 'Settings' } } }], ['chat', { m_popup: win }]]) });
 return {win, calls, container};
}
test('resolve the routed friend container among other Steam popups without creating chats', () => {
 const {calls}=setup(); expect(Buffer.from(chatFocusTarget(`steam://friends/message/${sid}`)!, 'base64').toString()).toBe('a chat Ω'); expect(calls).toEqual([[42,false]]);
});
test('refuse unknown, group and malformed routes', () => {
 setup(); for(const route of [null,'action:chatroom:1','steam://friends/message/0','steam://friends/message/76561197960265770/suffix']) expect(chatFocusTarget(route)).toBeNull();
});
test('refuse closed, unregistered, hidden or malformed windows', () => {
 const {win}=setup(); win.closed=true; expect(chatFocusTarget(`steam://friends/message/${sid}`)).toBeNull();
 win.closed=false; win.document.visibilityState='hidden'; expect(chatFocusTarget(`steam://friends/message/${sid}`)).toBeNull();
 win.document.visibilityState='visible'; win.document.title='bad\u0000title'; expect(chatFocusTarget(`steam://friends/message/${sid}`)).toBeNull();
 win.document.title='valid'; Reflect.set(globalThis,'g_PopupManager',{m_mapPopups:new Map()}); expect(chatFocusTarget(`steam://friends/message/${sid}`)).toBeNull();
});
test('refuse missing or throwing Steam stores', () => { setup(); Reflect.set(globalThis,'g_FriendsUIApp',{m_ChatStore:{GetFriendChat(){throw Error('unready')}}}); expect(chatFocusTarget(`steam://friends/message/${sid}`)).toBeNull(); });
