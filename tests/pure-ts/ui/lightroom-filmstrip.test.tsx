import { describe, expect, test } from 'bun:test';

import {
  buildFilmstripEdgeHeaderModel,
  getFilmstripColumnWidth,
  truncateFilmstripFilename,
} from '../../../src/components/panel/Filmstrip.tsx';

describe('dense filmstrip lane policy', () => {
  test('keeps edge header identity bounded while retaining the active source point', () => {
    const model = buildFilmstripEdgeHeaderModel({
      activeIndex: 17,
      activePath: '/private/alaska/20260717_glacier_lake_sunrise_original_super_long_exposure_sequence_frame_2026.ARW',
      imageCount: 2400,
      noActiveLabel: 'No active image',
      selectedCount: 3,
      totalImages: 2400,
    });

    expect(model).toEqual({
      activeFilename: '20260717_glacier_lake_sunrise_...xposure_sequence_frame_2026.ARW',
      displayCount: 2400,
      selectedCount: 3,
      shownIndex: 18,
    });
  });

  test('keeps fixed virtual columns across compact and tall lanes', () => {
    expect(getFilmstripColumnWidth(66)).toBe(74);
    expect(getFilmstripColumnWidth(180)).toBe(188);
  });

  test('does not emit an unbounded filename for long catalog paths', () => {
    expect(truncateFilmstripFilename('a'.repeat(200), 40)).toHaveLength(40);
  });
});
