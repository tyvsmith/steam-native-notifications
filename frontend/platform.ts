import { ffi } from 'millennium';
import type { Platform } from './presentation';

const queryPlatform = ffi<[], string>('Platform');
const PLATFORM_TIMEOUT_MS = 1500;
let pending: Promise<Platform> | undefined;

/** Share one authoritative backend query; allow retries if the backend was unavailable. */
export function loadPlatform(): Promise<Platform> {
	if (!pending) {
		const query = Promise.resolve().then(queryPlatform).then((raw): Platform => {
			const value = raw.startsWith('"') ? JSON.parse(raw) : raw;
			return value === 'windows' || value === 'linux' || value === 'macos' ? value : 'unknown';
		}).catch((): Platform => 'unknown');
		let timer: ReturnType<typeof setTimeout>;
		const timeout = new Promise<Platform>((resolve) => {
			timer = setTimeout(() => resolve('unknown'), PLATFORM_TIMEOUT_MS);
		});
		pending = Promise.race([query, timeout]).then((value) => {
			clearTimeout(timer);
			if (value === 'unknown') pending = undefined;
			return value;
		});
	}
	return pending;
}
