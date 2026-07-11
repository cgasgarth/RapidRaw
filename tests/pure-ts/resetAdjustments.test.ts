import { describe, expect, test } from 'bun:test';

import { resolveResetTargetPaths } from '../../src/utils/resetAdjustments';

describe('resolveResetTargetPaths', () => {
  test('explicit targets override editor and library state', () => {
    expect(resolveResetTargetPaths(['explicit.raw'], 'active.raw', ['stale.raw'], 'library.raw')).toEqual([
      'explicit.raw',
    ]);
  });

  test('active editor image wins over stale multi-selection', () => {
    expect(resolveResetTargetPaths(undefined, 'active.raw', ['stale-a.raw', 'stale-b.raw'], 'library.raw')).toEqual([
      'active.raw',
    ]);
  });

  test('falls back through multi-selection and library active image', () => {
    expect(resolveResetTargetPaths(undefined, undefined, ['selected.raw'], 'library.raw')).toEqual(['selected.raw']);
    expect(resolveResetTargetPaths(undefined, undefined, [], 'library.raw')).toEqual(['library.raw']);
    expect(resolveResetTargetPaths(undefined, undefined, [], undefined)).toEqual([]);
  });
});
