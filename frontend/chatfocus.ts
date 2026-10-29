/** Resolve only Steam's registered root-desktop container for a routed friend. */
export function chatFocusTarget(fallback: string | null): string | null {
 try {
  const match = /^steam:\/\/friends\/message\/(\d{17})$/.exec(fallback ?? '');
  if (!match) return null;
  const account = BigInt(match[1]) - 76561197960265728n;
  if (account <= 0n || account > 0xffffffffn) return null;
  const app = Reflect.get(globalThis, 'g_FriendsUIApp');
  const chat = app?.m_ChatStore?.GetFriendChat?.(Number(account), false);
  if (!chat) return null;
  const container = app?.m_UIStore?.GetAppContainerForChat?.(chat);
  const win = container?.m_window;
  if (!win || container.BIsClosed() || win.closed || win.document?.visibilityState !== 'visible') return null;
  const popups: Iterable<any> = Reflect.get(globalThis, 'g_PopupManager')?.m_mapPopups?.values?.() ?? [];
  if (![...popups].some(p => (p?.window ?? p?.m_popup) === win)) return null;
  const title: unknown = win.document.title;
  if (typeof title !== 'string' || !title.trim() || title.length > 512 || /[\u0000-\u001f\u007f]/.test(title)) return null;
  return btoa(String.fromCharCode(...new TextEncoder().encode(title)));
 } catch { return null; }
}

/** Refresh container/title discovery while a dispatched chat is being created. */
export async function waitForChatFocusTarget(fallback: string | null): Promise<string | null> {
 const current = chatFocusTarget(fallback);
 if (current || !/^steam:\/\/friends\/message\/\d{17}$/.test(fallback ?? '')) return current;
 return new Promise(resolve => {
  const deadline = Date.now() + 4000;
  const timer = window.setInterval(() => {
   const target = chatFocusTarget(fallback);
   if (!target && Date.now() < deadline) return;
   window.clearInterval(timer);
   resolve(target);
  }, 100);
 });
}
