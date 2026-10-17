import { expect, test } from 'bun:test';
import { previousNumberedTag, releaseNotes } from './release-notes';

test('notes skip the moving tag, current release, and non-version tags', () => {
  expect(previousNumberedTag(['latest', 'v0.2.0', 'preview', 'v0.1.0'], 'v0.2.0')).toBe('v0.1.0');
});

test('first release has no base and uses explicit commit notes', () => {
  expect(previousNumberedTag(['latest', 'v0.1.0'], 'v0.1.0')).toBeUndefined();
  expect(releaseNotes('abc123 initial implementation\ndef456 fix clicks\n')).toBe('- abc123 initial implementation\n- def456 fix clicks\n');
});

test('numbered prereleases can be a notes base', () => {
  expect(previousNumberedTag(['latest', 'v0.1.0-rc.1'], 'v0.1.0')).toBe('v0.1.0-rc.1');
});
