import { expect, test } from 'bun:test';
import { sampleMessage } from './command-result';
test('all editors distinguish execution, queue, refusal and unmeasured delivery', () => {
    const result = { stage: 'executed' };
    expect(sampleMessage(result)).toBe(sampleMessage({ ok: true, value: result }));
    expect(sampleMessage(result)).toContain('visibility have not been confirmed');
    expect(sampleMessage({ stage: 'queued' })).toContain('has not confirmed execution');
    expect(sampleMessage({ ok: false, error: 'disabled' })).toContain('disabled');
    expect(sampleMessage(undefined)).toContain('not been confirmed');
});
