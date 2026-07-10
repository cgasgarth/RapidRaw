import { describe, expect, test } from 'bun:test';
import { resolveExportTargetPaths } from '../../../src/utils/export/exportTargetPaths';

describe('resolveExportTargetPaths', () => {
  test('exports the active editor image instead of a stale filmstrip selection', () => {
    expect(
      resolveExportTargetPaths({
        isLibraryContext: false,
        multiSelectedPaths: ['/Alaska/_DSC7509.ARW'],
        selectedImagePath: '/Alaska/_DSC7505.ARW',
      }),
    ).toEqual(['/Alaska/_DSC7505.ARW']);
  });

  test('keeps the explicit multi-selection in library context', () => {
    expect(
      resolveExportTargetPaths({
        isLibraryContext: true,
        multiSelectedPaths: ['/Alaska/_DSC7505.ARW', '/Alaska/_DSC7509.ARW'],
        selectedImagePath: '/Alaska/_DSC7505.ARW',
      }),
    ).toEqual(['/Alaska/_DSC7505.ARW', '/Alaska/_DSC7509.ARW']);
  });
});
