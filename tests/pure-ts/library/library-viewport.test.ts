import { describe, expect, test } from 'bun:test';
import type { LibraryRow } from '../../../src/components/panel/library/LibraryItems';
import {
  captureLibraryViewportAnchor,
  classifyLibraryLayoutChange,
  type LibraryLayoutSnapshot,
  resolveLibraryViewportAnchor,
} from '../../../src/components/panel/library/libraryViewport';
import type { ImageFile } from '../../../src/components/ui/AppProperties';

const image = (path: string): ImageFile => ({
  path,
  rating: 0,
  modified: 0,
  is_edited: false,
  is_virtual_copy: false,
  tags: null,
  exif: null,
});

const imageRow = (...paths: string[]): LibraryRow => ({
  type: 'images',
  startIndex: 0,
  images: paths.map((path) => ({ image: image(path) })),
});

const layout = (
  rows: LibraryRow[],
  options: Partial<Omit<LibraryLayoutSnapshot, 'rows'>> = {},
): LibraryLayoutSnapshot => ({
  rows,
  rowHeight: 100,
  headerHeight: 40,
  footerHeight: 12,
  contentRevision: rows,
  sessionId: null,
  ...options,
});

describe('library viewport transitions', () => {
  test('classifies dimensions, measurement, ordering, and session changes independently', () => {
    const rows = [imageRow('/a.raw'), { type: 'footer' } satisfies LibraryRow];
    const initial = layout(rows);
    expect(classifyLibraryLayoutChange(initial, { ...initial })).toBe('dimensions-only');
    expect(classifyLibraryLayoutChange(initial, { ...initial, rowHeight: 120 })).toBe('row-heights');
    expect(classifyLibraryLayoutChange(initial, layout([...rows]))).toBe('order-or-membership');
    expect(classifyLibraryLayoutChange(initial, { ...initial, sessionId: 'other' })).toBe('session-replaced');
  });

  test('keeps the first visible path and relative offset when row heights change', () => {
    const before = layout([imageRow('/a.raw'), imageRow('/b.raw'), imageRow('/c.raw'), { type: 'footer' }]);
    const anchor = captureLibraryViewportAnchor(before, 135);
    const after = { ...before, rowHeight: 160 };
    expect(anchor).toMatchObject({ path: '/b.raw', rowIndex: 1, offsetWithinRowPx: 35, fallbackScrollTop: 135 });
    expect(resolveLibraryViewportAnchor(after, anchor)).toBe(195);
  });

  test('anchors surviving active content across sort and uses pixel fallback after filtering', () => {
    const before = layout([imageRow('/a.raw'), imageRow('/b.raw'), imageRow('/c.raw'), { type: 'footer' }]);
    const activeAnchor = captureLibraryViewportAnchor(before, 0, '/b.raw');
    const sorted = layout([imageRow('/c.raw'), imageRow('/a.raw'), imageRow('/b.raw'), { type: 'footer' }]);
    expect(resolveLibraryViewportAnchor(sorted, activeAnchor)).toBe(200);

    const filtered = layout([imageRow('/a.raw'), { type: 'footer' }]);
    expect(resolveLibraryViewportAnchor(filtered, { ...activeAnchor, fallbackScrollTop: 72 }, 40)).toBe(40);
  });

  test('accounts for recursive headers and clamps restoration to scroll bounds', () => {
    const rows: LibraryRow[] = [
      { type: 'header', path: '/folder', count: 2, isExpanded: true },
      imageRow('/a.raw'),
      imageRow('/b.raw'),
      { type: 'footer' },
    ];
    const anchor = captureLibraryViewportAnchor(layout(rows), 155);
    expect(anchor).toMatchObject({ path: '/b.raw', rowIndex: 2, offsetWithinRowPx: 15 });
    expect(resolveLibraryViewportAnchor(layout(rows, { rowHeight: 200 }), anchor, 230)).toBe(230);
  });
});
