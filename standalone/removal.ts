import { integrationCommand } from './installer';
import { setupPaths, UNIT, type Paths } from './paths';
import { systemctl, type Runner } from './service-lifecycle';

/** Finish cleanup before exiting, allowing time to acknowledge the panel. */
export function integrationRemoval(stop: () => void, paths: Paths = setupPaths(), run: Runner = systemctl, replyGraceMs = 5000) {
    let pending: Promise<unknown> | undefined;
    let removed = false;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
        if (!removed || stopped) return;
        stopped = true; clearTimeout(timer); stop();
    };
    return {
        async remove() {
            if (!pending) pending = (process.platform === 'win32' ? import('./windows-installer').then(m => m.windowsIntegration('teardown', [], paths, false)) : integrationCommand('teardown', [], paths, args =>
                run(args[0] === 'disable' && args[1] === '--now' && args[2] === UNIT ? ['disable', UNIT] : args)))
                .then(result => {
                    removed = true;
                    // A closed settings window or lost CDP reply must not keep an uninstalled daemon alive.
                    timer = setTimeout(finish, replyGraceMs); timer.unref();
                    return result;
                })
                .catch(error => { pending = undefined; throw error; });
            await pending;
            return { ok: true, removed: true };
        },
        acknowledged() {
            finish();
        },
    };
}
