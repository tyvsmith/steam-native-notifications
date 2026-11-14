import { BUILD_IDENTITY, type BuildIdentity } from '../shared/host';
import { CHECKOUT_ROOT, sourceBuildIdentity } from '../tools/gen-build-identity';

/**
 * The daemon and the frontend it injects must come from one build. Bundles
 * (release CLI, standalone frontend) carry the injected id; a run from source
 * computes it from the checkout, so a source daemon still refuses a frontend
 * built from other source.
 */
export const STANDALONE_IDENTITY: BuildIdentity & { buildId: string } = BUILD_IDENTITY.buildId !== null
    ? { ...BUILD_IDENTITY, buildId: BUILD_IDENTITY.buildId }
    : { ...BUILD_IDENTITY, buildId: (await sourceBuildIdentity(CHECKOUT_ROOT)).buildId };
