import { ffi } from 'millennium';
import { createRuntimeHost, bindHostMethod, type HostMethod } from '../shared/host';
/** Millennium and standalone supply the same positional compatibility factory. */
// Keep the SDK call direct so Starlight injects the plugin identity.
export const runtimeHost = createRuntimeHost(<Args extends unknown[], Result>(method: string) => ffi<Args, Result>(method));

export const hostMethod = <M extends HostMethod>(method: M) => bindHostMethod(runtimeHost, method);
