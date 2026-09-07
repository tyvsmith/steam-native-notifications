import { dlog } from './log';
import { chooseHandler, type Candidate } from './choose';
import { firstFiber } from './fiber';
import { captureAppIdFromToastName } from './click';

/**
 * The replay click path: a notification click re-runs the handler Steam
 * attached to the toast, taken from its React tree at capture time and
 * invoked later by the click bridge. choose.ts decides which handler a
 * click may run; a toast it refuses stays unclickable, the mirror of a
 * Steam toast whose click does nothing. Known limit (measured,
 * docs/experiments/click-replay.md): the handler is frozen to the surface
 * its toast rendered on.
 *
 * Every `replay: candidates` line is the health probe for the reflective
 * layers, in order: `n=0 (no fiber key)` -- the fiber convention moved;
 * `portal=miss` -- the HostPortal boundary moved; `stashed=none
 * (ambiguous)` -- Steam stopped drilling the handler object. No line at
 * all means the popup hook is dead. Diagnostics never throw; a failed walk
 * only costs that toast its click.
 */

/** Heap measurements put current handlers below 0.5KB each after forced GC. */
const STASH_MAX = 256;

const SNIPPET_LEN = 200;
const MAX_FIBERS = 5000;
/** Detail lines logged per anomalous toast; the rest is one +N summary. */
const LOG_CANDIDATES_MAX = 12;

/**
 * Candidate metadata without the function: what the stash retains for
 * --replay inspect. Only the CHOSEN handler's closure is retained; a portal
 * miss once collected 673 candidates, so all other entries are metadata.
 */
type CandidateMeta = Omit<Candidate, 'fn'>;

interface StashEntry {
	token: string;
	name: string;
	captureAppId: number;
	stashedAt: number;
	/** The proven handler, or null for an ambiguous toast kept for inspect. */
	fn: ((e: unknown) => unknown) | null;
	chosen: CandidateMeta | null;
	candidateCount: number;
	candidates: CandidateMeta[];
}

const stash = new Map<string, StashEntry>();

function toMeta({ fn: _fn, ...meta }: Candidate): CandidateMeta {
	return meta;
}

function pruneStash(): void {
	while (stash.size > STASH_MAX) {
		const oldest = stash.keys().next().value;
		if (oldest === undefined) break;
		stash.delete(oldest);
	}
}

function fnMeta(fn: unknown): { fnName: string; snippet: string } {
	try {
		return {
			fnName: (fn as { name?: string })?.name ?? '',
			snippet: String(fn).replace(/\s+/g, ' ').slice(0, SNIPPET_LEN),
		};
	} catch {
		return { fnName: '', snippet: '<toString failed>' };
	}
}

/**
 * The toast popup is portal-rendered from the main window's React tree, so
 * the walk roots at the HostPortal fiber (tag 4) whose containerInfo lives
 * in the popup's document -- rooting any higher sweeps the whole Steam UI
 * (the 673-candidate incident in the experiment doc). Fallback when no
 * portal is found: the highest fiber whose stateNode is still in the popup
 * document.
 */
function toastSubtreeRoot(fiber: any, doc: Document): { root: any; viaPortal: boolean } {
	let cur = fiber;
	let best = fiber;
	for (let up = 0; cur && up < 80; up++) {
		try {
			if (cur.tag === 4 && cur.stateNode?.containerInfo?.ownerDocument === doc) {
				return { root: cur, viaPortal: true };
			}
			const sn = cur.stateNode;
			if (sn && typeof sn === 'object' && sn.ownerDocument === doc) best = cur;
			// A host fiber in ANOTHER document means the portal boundary was
			// passed without matching; everything above is main-window tree.
			if (sn && typeof sn === 'object' && sn.ownerDocument && sn.ownerDocument !== doc) break;
		} catch {
			/* hostile getters must not stop the climb */
		}
		cur = cur.return;
	}
	return { root: best, viaPortal: false };
}

/**
 * Collect handler-bearing fibers breadth-first from the root, so the array
 * comes back shallowest-first.
 */
function collectCandidates(rootFiber: any): Candidate[] {
	const candidates: Candidate[] = [];
	let queue: { fiber: any; depth: number }[] = [{ fiber: rootFiber, depth: 0 }];
	let visited = 0;
	while (queue.length > 0 && visited < MAX_FIBERS) {
		const next: typeof queue = [];
		for (const { fiber, depth } of queue) {
			if (!fiber || visited >= MAX_FIBERS) break;
			visited++;
			try {
				const props = fiber.memoizedProps ?? fiber.pendingProps;
				if (props && typeof props === 'object') {
					for (const prop of ['onClick', 'onActivate']) {
						const fn = props[prop];
						if (typeof fn === 'function') candidates.push({ prop, depth, fn, ...fnMeta(fn) });
					}
				}
			} catch {
				/* a fiber with hostile props must not stop the walk */
			}
			for (let child = fiber.child; child; child = child.sibling) {
				next.push({ fiber: child, depth: depth + 1 });
			}
		}
		queue = next;
	}
	return candidates;
}

/**
 * Walk the toast's tree, stash the handler choose.ts proves, and return the
 * click token the notification should carry -- null when the toast must
 * stay unclickable. Called from deliverToast before the popup can be
 * closed; never throws, never blocks delivery. An ambiguous toast is
 * stashed without a handler so --replay inspect can still show what the
 * walk saw.
 */
export function stashToastHandler(win: Window, name: string, token: string): boolean {
	try {
		const captureAppId = captureAppIdFromToastName(name);
		if (captureAppId === null) return false;
		const doc = win.document;
		if (!doc) return false;
		const fiber = firstFiber(doc);
		if (!fiber) {
			dlog(`replay: candidates ${name} n=0 (no fiber key in toast document)`);
			return false;
		}

		const { root, viaPortal } = toastSubtreeRoot(fiber, doc);
		const candidates = collectCandidates(root);
		const picked = chooseHandler(candidates);
		const health = viaPortal ? '' : ' portal=miss';
		const summary = picked
			? `stashed=${picked.chosen.prop}@${picked.chosen.depth} (${picked.how})`
			: 'stashed=none (ambiguous)';
		dlog(`replay: candidates ${name} n=${candidates.length} ${summary}${health}`);
		// Detail only on anomaly, and capped: the summary line carries the
		// whole health signal, and each detail line is a callable plus a file
		// write -- unbounded, a portal miss would emit hundreds per toast.
		if (!picked || !viaPortal) {
			candidates.slice(0, LOG_CANDIDATES_MAX).forEach((c, i) => {
				dlog(`replay: candidate ${name} #${i} ${c.prop}@${c.depth} name=${c.fnName || '(anon)'} :: ${c.snippet}`);
			});
			if (candidates.length > LOG_CANDIDATES_MAX) {
				dlog(`replay: candidate ${name} +${candidates.length - LOG_CANDIDATES_MAX} more`);
			}
		}

		stash.delete(token);
		stash.set(token, {
			token,
			name,
			captureAppId,
			stashedAt: Date.now(),
			fn: picked?.chosen.fn ?? null,
			chosen: picked ? toMeta(picked.chosen) : null,
			candidateCount: candidates.length,
			// A portal miss can see hundreds of unrelated handlers. The health
			// line keeps the total; inspect retains only bounded diagnostics.
			candidates: candidates.slice(0, LOG_CANDIDATES_MAX).map(toMeta),
		});
		pruneStash();
		return picked !== null;
	} catch (e) {
		dlog(`replay: walk failed for ${name}: ${(e as Error)?.message ?? e}`);
		return false;
	}
}

/** Dump the stash: names, ages, candidate metadata. The --replay inspect door. */
export function inspectReplayStash(): void {
	dlog(`replay: stash size=${stash.size}`);
	for (const entry of stash.values()) {
		const age = Math.round((Date.now() - entry.stashedAt) / 1000);
		const chosen = entry.chosen ? `${entry.chosen.prop}@${entry.chosen.depth}` : 'none';
		dlog(`replay: stash ${entry.name} token=${entry.token.slice(0, 8)} age=${age}s n=${entry.candidateCount} chosen=${chosen}`);
		entry.candidates.forEach((c, i) => {
			dlog(`replay: stash ${entry.name} #${i} ${c.prop}@${c.depth} name=${c.fnName || '(anon)'} :: ${c.snippet}`);
		});
	}
}

function replayEligible(entry: StashEntry | undefined, focusedAppId: number): boolean {
	return !!entry?.fn && !!entry.chosen && entry.captureAppId === focusedAppId;
}

/** Check before preparing a window; invocation rechecks after that async step. */
export function canReplayHandler(token: string, focusedAppId: number): boolean {
	return replayEligible(stash.get(token), focusedAppId);
}

/**
 * Invoke a stashed handler with a stub event. No identifier targets the most
 * recent entry for the tools/fire probe. Every caller supplies a confirmed
 * current surface; the stored capture must match it. A throw is logged and
 * swallowed. Returns whether a matching handler ran without throwing.
 */
export function invokeReplayHandler(identifier: string | undefined, focusedAppId: number): boolean {
	let entry: StashEntry | undefined;
	if (identifier) {
		entry = stash.get(identifier);
		if (!entry) {
			for (const candidate of stash.values()) {
				if (candidate.name === identifier) entry = candidate;
			}
		}
	} else {
		for (const e of stash.values()) entry = e; // last = most recent
	}
	if (!entry) {
		dlog(`replay: invoke ${identifier ?? '(latest)'} -> no stash entry`);
		return false;
	}
	// The URL's appid is untrusted; only the capture stored with this closure
	// may authorize replay on the current surface.
	if (!replayEligible(entry, focusedAppId)) {
		if (entry.captureAppId !== focusedAppId) {
			dlog(`replay: invoke ${entry.name} -> surface mismatch capture=${entry.captureAppId} current=${focusedAppId}`);
		} else {
			dlog(`replay: invoke ${entry.name} -> entry has no handler`);
		}
		return false;
	}
	const age = Math.round((Date.now() - entry.stashedAt) / 1000);
	dlog(`replay: invoke ${entry.name} ${entry.chosen.prop}@${entry.chosen.depth} age=${age}s`);
	const stubEvent = {
		preventDefault() {},
		stopPropagation() {},
	};
	try {
		entry.fn(stubEvent);
		dlog(`replay: invoke ${entry.name} -> returned without throwing`);
		return true;
	} catch (e) {
		const err = e as Error;
		dlog(`replay: invoke ${entry.name} -> THREW ${err?.name ?? ''}: ${err?.message ?? String(e)}`);
		if (err?.stack) dlog(`replay: invoke stack: ${String(err.stack).replace(/\s+/g, ' ').slice(0, 500)}`);
		return false;
	}
}
