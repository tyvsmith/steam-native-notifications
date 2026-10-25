import { dependencies } from './dependencies';
import { runtimeAsset } from './runtime-paths';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BUILD_IDENTITY } from '../shared/host';
import { sampleCommand, validateDevCommand } from '../shared/dev-command';
import type { Host } from './host';
import type { ControlRequest } from './control';
export function controlHandler(host: Host) {
    return async (request: ControlRequest): Promise<unknown> => {
        switch (request.operation) {
            case 'status': {
                await host.refreshFrontend?.();
                const compatible = host.live.frontendBuild?.buildId === BUILD_IDENTITY.buildId && host.live.control === true;
                const degraded = host.live.state === 'ready' && (!compatible || host.live.hook === 'failed');
                return { host: 'standalone', build: BUILD_IDENTITY, installedBuild: await installedBuild(), ...host.live,
                    state: degraded ? 'degraded' : host.live.state,
                    action: degraded ? 'Restart Steam to load the installed frontend; check hook diagnostics if capture remains unavailable' : null,
                    pid: process.pid, configPath: host.config, config: await host.store.read(),
                    dependencies: dependencies(),
                    capabilities: { settingsWrite: true, sample: compatible && !!host.frontendCommand, developerCommands: compatible && !!host.frontendCommand } };
            }
            case 'capture': { const count = request.payload ?? 8; if (!Number.isSafeInteger(count) || (count as number) < 0 || (count as number) > 100) throw new Error('Capture count must be 0–100'); let log = ''; try { log = await readFile(host.logPath, 'utf8'); } catch { try { log = await readFile(join(host.runtime, 'standalone.log'), 'utf8'); } catch {} } return { host: 'standalone', live: host.live, lines: log.trim().split('\n').slice(-(count as number) || log.length).slice(0, count as number).map(line => line.slice(0, 320)), evidence: 'Historical log; banner visibility is unmeasured' }; }
            case 'config.read': return host.store.read();
            case 'config.update': return host.store.update(request.payload, request.deadline);
            case 'config.reset': return host.store.reset(request.deadline);
            case 'sample': case 'dev.fire': {
                await host.refreshFrontend?.();
                const sample = request.operation === 'sample';
                const command = sample ? sampleCommand() : validateDevCommand(request.payload);
                if (!sample && !(await host.store.read()).values.devFire) throw new Error('Developer commands are disabled');
                if (host.live.state !== 'ready' || !host.frontendCommand) throw new Error('Frontend unavailable; start Steam and the standalone daemon');
                if (host.live.frontendBuild?.buildId !== BUILD_IDENTITY.buildId) throw new Error('Frontend build is stale; restart Steam to load the installed bundle');
                if (request.deadline <= Date.now()) throw new Error('Request expired');
                return host.frontendCommand({ id: request.id, createdAt: Date.now(), deadline: request.deadline, command }, sample);
            }
        }
    };
}
async function installedBuild(): Promise<unknown> { try { return JSON.parse(await readFile(runtimeAsset('dist/standalone/build.json'), 'utf8')); } catch { return null; } }
