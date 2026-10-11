import { ffi } from 'millennium';
import { createRuntimeHost, bindHostMethod, type HostMethod } from '../shared/host';
/** Millennium and standalone supply the same positional compatibility factory. */
export const runtimeHost = createRuntimeHost(ffi);

export const hostMethod = <M extends HostMethod>(method: M) => bindHostMethod(runtimeHost, method);
