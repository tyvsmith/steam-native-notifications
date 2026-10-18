import { expect, test } from 'bun:test';
import { useSettingsActions } from './settings-actions';

function panel() {
    const state: unknown[] = [];
    const effects: (() => (() => void))[] = [];
    const react = {
        useState(initial: unknown) { const index = state.push(initial) - 1; return [initial, (value: unknown) => { state[index] = value; }]; },
        useRef(current: unknown) { return { current }; },
        useEffect(effect: () => () => void) { effects.push(effect); },
    } as unknown as typeof import('react');
    const actions = useSettingsActions(react);
    const cleanups = effects.map(effect => effect());
    return { actions, state, close: () => cleanups.forEach(cleanup => cleanup()) };
}
function pending<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

test('a completed save wins over a previously started poll', async () => {
    const { actions, state } = panel();
    const read = pending<boolean>();
    let enabled = false;
    const polling = actions.refresh(() => read.promise, value => { enabled = value; });
    await actions.run(async () => true, value => { enabled = value; return 'Saved.'; });
    read.resolve(false); await polling;
    expect(enabled).toBe(true);
    expect(state.slice(0, 3)).toEqual([false, 'Saved.', '']);
});

test('writes serialize and reads cannot replace an in-flight write', async () => {
    const { actions, state } = panel();
    const write = pending<boolean>();
    let calls = 0;
    const saving = actions.run(() => write.promise, () => 'Saved.');
    await actions.run(async () => { calls++; }, () => 'Duplicate');
    await actions.refresh(async () => { calls++; }, () => {});
    expect(calls).toBe(0); expect(state[0]).toBe(true);
    write.resolve(true); await saving;
    expect(state[0]).toBe(false);
});

test('unmount discards late results and their render callbacks', async () => {
    const { actions, close, state } = panel();
    const write = pending<boolean>();
    let applied = false;
    const saving = actions.run(() => write.promise, () => { applied = true; return 'Saved.'; });
    close(); const before = [...state];
    write.resolve(true); await saving;
    expect(applied).toBe(false); expect(state).toEqual(before);
});

test('failed operations retain confirmation and allow retry', async () => {
    const { actions, state } = panel();
    actions.setConfirmReset(true);
    await actions.run(async () => { throw new Error('Service unavailable'); }, () => 'Impossible');
    expect(state).toEqual([false, '', 'Service unavailable', true]);
    await actions.run(async () => {}, () => 'Defaults restored.');
    expect(state).toEqual([false, 'Defaults restored.', '', false]);
});

test('latest read wins over an older snapshot', async () => {
    const { actions } = panel();
    const old = pending<boolean>(); let value = false;
    const polling = actions.refresh(() => old.promise, next => { value = next; });
    await actions.refresh(async () => true, next => { value = next; });
    old.resolve(false); await polling;
    expect(value).toBe(true);
});


test('read failures after unmount do not change availability', async () => {
    const { actions, close } = panel();
    const read = pending<boolean>(); let unavailable = false;
    const polling = actions.refresh(async () => { await read.promise; throw new Error('offline'); }, () => {}, () => { unavailable = true; });
    close(); read.resolve(true); await polling;
    expect(unavailable).toBe(false);
});
