import { isAbsolute } from 'node:path';
import { configStore, type ConfigStore } from './config-store';
import { preferenceDefaults } from '../shared/settings-policy';
import { isSettingKey, validateSettingsPatch, type SettingKey } from '../shared/settings';
import { readConfig, updateConfig, resetConfig, type HostSelection } from '../tools/lib/host-client';

/** Explicit file recovery never discovers or mutates another host. */
export async function explicitConfigStore(path: string): Promise<ConfigStore> {
    if (!isAbsolute(path)) throw new Error('--config requires an absolute path');
    return configStore(path);
}
export async function configCommand(args: string[], select = explicitConfigStore, host: HostSelection = 'auto') {
    const positional: string[] = []; let path: string | undefined;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--config') {
            if (path || !args[i + 1]) throw new Error('Expected one --config FILE');
            path = args[++i];
        } else positional.push(args[i]!);
    }
    const [command, key, value] = positional;
    if (!(command === 'get' && positional.length <= 2) && !(command === 'reset' && positional.length === 1) &&
        !(command === 'set' && positional.length === 3 && (value === 'true' || value === 'false'))) {
        throw new Error('Usage: snn config get [KEY]|set KEY true|false|reset [--config FILE]');
    }
    if (key !== undefined && !isSettingKey(key)) throw new Error(`Invalid setting: ${key}`);
    const patch = command === 'set' ? validateSettingsPatch({ [key!]: value === 'true' }) : undefined;
    if (path && host === 'millennium') throw new Error('--config targets standalone only');
    if (path) {
        const store = await select(path);
        const result = command === 'get' ? await store.read() : command === 'reset'
            ? await store.update(preferenceDefaults('linux')) : await store.update(patch);
        if (result.error) throw new Error(`${store.path}: ${result.error}; repair the file before writing`);
        return { path: store.path, ...result, values: key && command === 'get' ? { [key]: result.values[key as SettingKey] } : result.values };
    }
    const result = command === 'get' ? await readConfig(host) : command === 'reset'
        ? await resetConfig(host) : await updateConfig(patch, host);
    if (result.error) throw new Error(result.error);
    return { ...result, values: key && command === 'get' ? { [key]: result.values[key as SettingKey] } : result.values };
}
