import { isAbsolute } from 'node:path';
import { configStore, type ConfigStore } from './config-store';
import { controlCall } from './control';
import { preferenceDefaults } from '../shared/settings-policy';

/** Pin the daemon's config target, or use the offline default when no daemon exists. */
export async function commandStore(explicit?: string): Promise<ConfigStore> {
    if (explicit) {
        if (!isAbsolute(explicit)) throw new Error('--config requires an absolute path');
        return configStore(explicit);
    }
    try {
        const status = await controlCall('status');
        if (typeof status.configPath !== 'string' || !isAbsolute(status.configPath)) throw new Error('Daemon did not identify its configuration file');
        return configStore(status.configPath);
    } catch (error: any) {
        if (!process.env.XDG_RUNTIME_DIR || error.code === 'ENOENT' || error.code === 'ECONNREFUSED') return configStore();
        throw error;
    }
}
export async function configCommand(args: string[], select = commandStore) {
    const positional: string[] = []; let path: string | undefined;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--config') {
            if (path || !args[i + 1]) throw new Error('Expected one --config FILE');
            path = args[++i];
        } else positional.push(args[i]!);
    }
    const [command, key, value] = positional;
    if (!((command === 'get' || command === 'reset') && positional.length === 1) &&
        !(command === 'set' && positional.length === 3 && (value === 'true' || value === 'false'))) {
        throw new Error('Usage: snn config get|set KEY true|false|reset [--config FILE]');
    }
    const store = await select(path);
    const result = command === 'get' ? await store.read() : command === 'reset'
        ? await store.update(preferenceDefaults('linux')) : await store.update({ [key!]: value === 'true' });
    if (result.error) throw new Error(`${store.path}: ${result.error}; repair the file before writing`);
    return { path: store.path, ...result };
}
