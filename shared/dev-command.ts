import type { DevCommand } from '../tools/lib/devtools';
// Named methods observed in docs/steam-routing.md. Never expose a general store method door.
const TESTS = new Set(['TestFriendOnline', 'TestFriendIngame', 'TestFriendMessage', 'TestAchievement', 'TestDownloadComplete', 'TestSystemUpdate', 'TestFriendInviteRollup', 'TestCloudSyncConflict', 'TestCloudSyncFailure', 'TestWishlist', 'TestComment']);
export function validateDevCommand(raw: unknown): DevCommand {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || JSON.stringify(raw).length > 32768) throw new Error('Invalid developer command');
    const c = raw as any;
    if (Object.keys(c).length !== (c.call ? 2 : 1)) throw new Error('Unexpected developer command fields');
    if (c.call === 'TestIncomingVoiceChat') throw new Error('TestIncomingVoiceChat is blocked: fake calls wedge Steam until restart');
    if (c.call && TESTS.has(c.call) && Array.isArray(c.args)) return c;
    if (c.server && Number.isSafeInteger(c.server.type) && c.server.type >= 0 && c.server.type <= 65535 && Object.keys(c.server).every(k => ['type', 'body'].includes(k))) return c;
    if (c.overlay?.call === 'info' && Object.keys(c.overlay).length === 1) return c;
    if (['inspect', 'invoke'].includes(c.replay?.call) && (c.replay.name === undefined || /^[A-Za-z0-9_.-]+$/.test(c.replay.name)) && Object.keys(c.replay).every(k => ['call', 'name'].includes(k))) return c;
    throw new Error('Unsupported developer command; only approved Test methods and server/overlay/replay diagnostics are accepted');
}
export interface DevEnvelope { id: string; createdAt: number; deadline: number; command: DevCommand }
