import { expect, test } from 'bun:test';
import { resolveRuntimeRoot } from './runtime-paths';

test('source and packaged module paths resolve assets without the runtime executable', () => {
    expect(resolveRuntimeRoot('/checkout/standalone')).toBe('/checkout');
    expect(resolveRuntimeRoot('/home/user/.bun/install/global/node_modules/@tyvsmith/steam-native-notifications/standalone')).toBe('/home/user/.bun/install/global/node_modules/@tyvsmith/steam-native-notifications');
    expect(resolveRuntimeRoot('/usr/lib/steam-native-notifications/standalone')).toBe('/usr/lib/steam-native-notifications');
    expect(resolveRuntimeRoot('C:\\checkout\\standalone')).toBe('C:\\checkout');
});
