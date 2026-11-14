import { BUILD_IDENTITY } from '../shared/host';

declare const __SNN_BUILD_ID__: string;
/** The daemon and its injected frontend must match: bundles carry the injected id, source runs hash the checkout. */
export const STANDALONE_IDENTITY = {
    ...BUILD_IDENTITY,
    buildId: typeof __SNN_BUILD_ID__ === 'string' ? __SNN_BUILD_ID__ : await (await import('./source-hash')).sourceBuildId(),
};
/** Bun.build `define` that stamps this identity into a bundle. */
export const IDENTITY_DEFINE = {
    __SNN_BUILD_ID__: JSON.stringify(STANDALONE_IDENTITY.buildId),
    __SNN_VERSION__: JSON.stringify(STANDALONE_IDENTITY.version),
};
/** Whether a reported build (frontend or daemon) is this one. */
export const isThisBuild = (build: { buildId?: string | null } | null | undefined): boolean => build?.buildId === STANDALONE_IDENTITY.buildId;
