import { sampleMessage } from '../shared/command-result';
import {
    visibleSettings,
    settingDisabled,
} from '../shared/settings-policy';
import type { SETTINGS_SCHEMA, Platform } from '../shared/settings';
import type { ConfigSnapshot } from './config-store';
import type { BuildIdentity } from '../shared/host';
interface State {
    config: ConfigSnapshot;
    schema: typeof SETTINGS_SCHEMA;
    platform: Platform;
    build: BuildIdentity;
    hosts: { host: string; present: boolean; state: string; action?: string }[];
    session: string;
}
const token =
    location.hash.slice(1) || sessionStorage.getItem('snn-session') || '';
if (token) sessionStorage.setItem('snn-session', token);
history.replaceState(null, '', location.pathname);
const el = <T extends HTMLElement = HTMLElement>(id: string) =>
    document.getElementById(id) as T;
let state: State;
let connected = false;
let writing = false;
let generation = 0;
let closed = false;

async function api<T>(path: string, body?: unknown): Promise<T> {
    const r = await fetch('/api/' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
            Authorization: 'Bearer ' + token,
            ...(body === undefined
                ? {}
                : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) {
        if (r.status === 401) sessionStorage.removeItem('snn-session');
        throw Error(data.error || 'Request failed');
    }
    return data;
}
function message(text: string) {
    el('result').textContent = text;
}

function render() {
    el('controls').replaceChildren();
    if (writing) el<HTMLButtonElement>('sample').disabled = true;
    for (const [group, title] of [
        ['presentation', 'Operating system notifications'],
        ['developer', 'Developer options'],
    ] as const) {
        if (group === 'developer' && !state.config.values.devMode) continue;
        const section = document.createElement('section'),
            h = document.createElement('h2');
        h.textContent = title;
        section.append(h);
        for (const key of visibleSettings(
            state.config.values,
            state.platform,
            state.schema,
        )) {
            const field = state.schema[key];
            if (field.developer !== (group === 'developer')) continue;
            const row = document.createElement('div'),
                label = document.createElement('label'),
                small = document.createElement('small'),
                input = document.createElement('input');
            row.className = 'row';
            label.htmlFor = key;
            label.textContent = field.label;
            small.textContent = field.description;
            if (field.description) label.append(small);
            input.type = 'checkbox';
            input.id = key;
            input.checked = state.config.values[key];
            input.disabled = !connected || !!state.config.error || writing || settingDisabled(state.config.values, key);
            input.onchange = async () => {
                if (writing || !connected) return;
                const checked = input.checked;
                writing = true;
                generation++;
                render();
                el<HTMLButtonElement>('reset').disabled = true;
                try {
                    state.config = await api<ConfigSnapshot>('config', {
                        [key]: checked,
                    });
                    message('Saved. Changes apply without restarting Steam.');
                } catch (e: unknown) {
                    message(e instanceof Error ? e.message : String(e));
                }
                writing = false;
                await refresh();
            };
            row.append(label, input);
            section.append(row);
        }
        el('controls').append(section);
    }
}
async function refresh() {
    if (writing || closed) return;
    const current = ++generation;
    try {
        const next = await api<State>('state');
        if (writing || closed || current !== generation) return;
        state = next;
        connected = true;
        el<HTMLButtonElement>('reset').disabled = !!state.config.error;
        el<HTMLButtonElement>('close').disabled = false;
        const host = state.hosts.find((h) => h.host === 'standalone');
        el('status').textContent = host?.present
            ? 'Standalone: ' + host.state
            : 'Offline — settings are saved for the next connection.';
        el('version').textContent =
            'Settings version ' +
            state.build.version +
            ' · build ' +
            state.build.buildId.slice(0, 12);
        el('version').title = 'Full build ' + state.build.buildId;
        el('health').textContent = state.config.error
            ? state.config.error +
              ' Displaying last-known or default values; writes are disabled.'
            : host?.action || '';
        el('session').textContent = state.session;
        el<HTMLButtonElement>('sample').disabled =
            !host?.present || host.state !== 'ready' || !state.config.values.integrationEnabled;
        render();
    } catch (e: unknown) {
        if (closed || current !== generation) return;
        connected = false;
        el('status').textContent =
            'Settings session unavailable. Run snn settings to reopen.';
        el('health').textContent =
            'Connection lost; displayed values may be stale.';
        for (const input of Array.from(
            document.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
                'input,button',
            ),
        ))
            input.disabled = true;
        message(e instanceof Error ? e.message : String(e));
    }
}
el<HTMLButtonElement>('reset').onclick = async () => {
    if (
        writing ||
        !connected ||
        !confirm('Reset standalone notification preferences to defaults?')
    )
        return;
    writing = true;
    generation++;
    render();
    el<HTMLButtonElement>('reset').disabled = true;
    try {
        state.config = await api<ConfigSnapshot>('reset', {});
        render();
        message('Defaults saved.');
    } catch (e: unknown) {
        message(e instanceof Error ? e.message : String(e));
    } finally {
        writing = false;
        await refresh();
    }
};
el<HTMLButtonElement>('sample').onclick = async () => {
    el<HTMLButtonElement>('sample').disabled = true;
    try {
        const result = await api('sample', {});
        message(sampleMessage(result));
        el('sample-details').hidden = !state.config.values.devMode;
        el('sample-json').textContent = state.config.values.devMode
            ? JSON.stringify(result, null, 2)
            : '';
    } catch (e: unknown) {
        el('sample-details').hidden = true;
        el('sample-json').textContent = '';
        message(
            'Sample could not run. ' +
                (e instanceof Error ? e.message : String(e)),
        );
    }
    await refresh();
};
el<HTMLButtonElement>('close').onclick = async () => {
    closed = true;
    generation++;
    try {
        await api('close', {});
        sessionStorage.removeItem('snn-session');
        message('Settings server closed. You can close this tab.');
        for (const input of Array.from(
            document.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
                'input,button',
            ),
        ))
            input.disabled = true;
        clearInterval(poll);
    } catch (e: unknown) {
        closed = false;
        message(e instanceof Error ? e.message : String(e));
        await refresh();
    }
};
refresh();
const poll = setInterval(refresh, 5000);
