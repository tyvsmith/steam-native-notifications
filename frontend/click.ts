export const CLICK_PAYLOAD_PREFIX = 'click:';
export const STEAM_URL_SECTION = 'steam-native-notify';
export const STEAM_URL_RESOURCE = 'notification';

export type FocusKind = 'chat' | 'main';

export interface ClickEnvelope {
	v: 1;
	token: string;
	/** 0 is the desktop surface; a positive value is the overlay appid. */
	captureAppId: number;
	/** A catalog route or action token; null means exact replay only. */
	fallback: string | null;
	/** Desktop window family: controls replay preparation and platform focus. */
	focus: FocusKind;
}

const TOKEN = /^[a-f0-9]{32}$/;
const ENCODED = /^[A-Za-z0-9_-]+$/;
const ACTION = /^action:(?:media|requestplaytime|screenshot:[A-Za-z0-9_.-]+|clip:[A-Za-z0-9_.-]+|chatroom:[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+)$/;
const MAX_ENCODED_ENVELOPE = 8192;
const UNSAFE_ROUTE_CHARACTER = /[\p{White_Space}\p{Cc}\p{Cf}]/u;

function fitsClickEnvelope(fallback: string): boolean {
	return (
		encodeClickEnvelope({
			v: 1,
			token: '0'.repeat(32),
			captureAppId: 0xffffffff,
			fallback,
			focus: 'chat',
		}).length <= MAX_ENCODED_ENVELOPE
	);
}

export function validSteamFallback(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		value.length <= 4096 &&
		/^steam:\/\/[A-Za-z0-9]/.test(value) &&
		!UNSAFE_ROUTE_CHARACTER.test(value) &&
		fitsClickEnvelope(value)
	);
}

function validFallback(value: unknown): value is string | null {
	if (value === null) return true;
	if (typeof value !== 'string') return false;
	if (ACTION.test(value)) return fitsClickEnvelope(value);
	return validSteamFallback(value);
}

function validEnvelope(value: unknown): value is ClickEnvelope {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const item = value as Record<string, unknown>;
	return (
		item.v === 1 &&
		typeof item.token === 'string' &&
		TOKEN.test(item.token) &&
		typeof item.captureAppId === 'number' &&
		Number.isSafeInteger(item.captureAppId) &&
		item.captureAppId >= 0 &&
		validFallback(item.fallback) &&
		(item.focus === 'chat' || item.focus === 'main')
	);
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
	const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
	const binary = atob(padded);
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function newClickToken(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function encodeClickEnvelope(value: unknown): string {
	const bytes = new TextEncoder().encode(JSON.stringify(value));
	return bytesToBase64(bytes).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function steamNotificationUrl(encoded: string): string {
	if (!ENCODED.test(encoded) || encoded.length > MAX_ENCODED_ENVELOPE) return '';
	return `steam://${STEAM_URL_SECTION}/${STEAM_URL_RESOURCE}/${encoded}`;
}

export function decodeClickEnvelope(encoded: string): ClickEnvelope | null {
	try {
		if (
			typeof encoded !== 'string' ||
			encoded.length === 0 ||
			encoded.length > MAX_ENCODED_ENVELOPE ||
			!ENCODED.test(encoded)
		) {
			return null;
		}
		const parsed: unknown = JSON.parse(new TextDecoder().decode(base64ToBytes(encoded)));
		return validEnvelope(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export function decodeClickPayload(payload: string): ClickEnvelope | null {
	if (typeof payload !== 'string' || !payload.startsWith(CLICK_PAYLOAD_PREFIX)) return null;
	return decodeClickEnvelope(payload.slice(CLICK_PAYLOAD_PREFIX.length));
}

export function clickEnvelopeFromSteamUrl(url: string): ClickEnvelope | null {
	const match = new RegExp(
		`^steam:\\/{1,2}${STEAM_URL_SECTION}\\/${STEAM_URL_RESOURCE}\/([A-Za-z0-9_-]+)\\/?$`,
	).exec(String(url).trim());
	return match ? decodeClickEnvelope(match[1]) : null;
}

export function captureAppIdFromToastName(name: string): number | null {
	// The identity after the surface marker is deliberately opaque. Steam uses
	// counters; Millennium currently uses "undefined". Neither is part of the
	// safety decision -- only the desktop suffix or validated overlay appid is.
	if (name.length > 512 || /[\u0000-\u0020]/.test(name)) return null;
	const desktop =
		name.startsWith('notificationtoasts_') &&
		name.endsWith('_desktop') &&
		name.length > 'notificationtoasts__desktop'.length;
	const overlay = /^notificationtoasts_uid(\d+)-[^\u0000-\u0020]+$/.exec(name);
	if (desktop === Boolean(overlay)) return null;
	if (desktop) return 0;
	const appid = Number(overlay?.[1]);
	return Number.isInteger(appid) && appid > 0 && appid <= 0xffffffff ? appid : null;
}

export function surfaceMatches(captureAppId: number, focusedAppId: number): boolean {
	return captureAppId === focusedAppId;
}

export type DeliveryMode = 'replay' | 'fallback' | 'none';

export function deliveryMode(
	envelope: ClickEnvelope,
	focusedAppId: number,
	replayAvailable: boolean,
): DeliveryMode {
	if (replayAvailable && surfaceMatches(envelope.captureAppId, focusedAppId)) return 'replay';
	return envelope.fallback ? 'fallback' : 'none';
}

export function focusKindFor(type: number | undefined, fallback: string | null): FocusKind {
	if ([3, 4, 8, 9, 17].includes(type ?? -1)) return 'chat';
	if (fallback?.startsWith('steam://friends/message/') || fallback?.startsWith('action:chatroom:')) return 'chat';
	return 'main';
}
