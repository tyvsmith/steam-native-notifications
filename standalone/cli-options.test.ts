import { expect, test } from 'bun:test';
import { parseCommonOptions } from './cli-options';
test('host and output options have the same meaning before and after commands', () => {
    for (const command of ['doctor', 'status', 'settings', 'capture']) {
        expect(parseCommonOptions(['--host', 'standalone', '--json', command])).toEqual(parseCommonOptions([command, '--json', '--host', 'standalone']));
    }
    expect(parseCommonOptions(['settings']).hostExplicit).toBe(false);
    expect(parseCommonOptions(['settings', '--host', 'auto']).hostExplicit).toBe(true);
    expect(() => parseCommonOptions(['--host'])).toThrow('--host');
    expect(parseCommonOptions(['dev', 'fire', '--server', '3', '{"x":true}']).args).toEqual(['dev', 'fire', '--server', '3', '{"x":true}']);
});
